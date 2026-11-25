// Umut Berke Şenyayla, 2000002240
import { assert, assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import { TaskCache } from "../src/cache.ts";
import { purgeOldDone } from "../src/jobs.ts";
import { Pool } from "../src/pool.ts";
import { createApp } from "../src/app.ts";
import { tasks } from "../src/schema.ts";
import { freshContext, loginAs, makeTask, send } from "./helpers.ts";

Deno.test("concurrent duplicate registration returns 201 and 409, never 500", async () => {
  const { app } = await freshContext();
  const responses = await Promise.all(
    [1, 2].map(() =>
      send(app, "POST", "/auth/register", {
        email: "race@example.com",
        password: "password123",
      })
    ),
  );
  assertEquals(responses.map((r) => r.status).sort(), [201, 409]);
});

Deno.test("purging an old task invalidates its cached response", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const cache = new TaskCache(kv);
    const { app, pool } = await freshContext({ cache });
    const token = await loginAs(app, "cache@example.com");
    const task = await makeTask(app, token, { title: "old task", status: "done" });
    await pool.use(async (db) => {
      await db.db.update(tasks).set({ completedAt: 1 }).where(eq(tasks.id, task.id));
    });
    assertEquals(
      (await send(app, "GET", `/api/tasks/${task.id}`, undefined, token)).status,
      200,
    );
    assertEquals(await pool.use((db) => purgeOldDone(db, 30, { cache })), 1);
    assertEquals(
      (await send(app, "GET", `/api/tasks/${task.id}`, undefined, token)).status,
      404,
    );
  } finally {
    kv.close();
  }
});

Deno.test("an in-flight stale cache load cannot overwrite a concurrent invalidation", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const cache = new TaskCache(kv);
    const { app, pool } = await freshContext();
    const token = await loginAs(app, "race-cache@example.com");
    const task = await makeTask(app, token, { title: "before" });
    const row = await pool.use(async (db) =>
      (await db.db.select().from(tasks).where(eq(tasks.id, task.id)))[0]!
    );
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const inFlight = cache.getOrLoad(row.userId, row.id, async () => {
      entered.resolve();
      await resume.promise;
      return row;
    });
    await entered.promise;
    await cache.drop(row.userId, row.id);
    resume.resolve();
    await inFlight;
    assertEquals((await kv.get(TaskCache.key(row.userId, row.id))).value, null);
  } finally {
    kv.close();
  }
});

Deno.test("healthz stays available while every database connection is held", async () => {
  const ctx = await freshContext();
  const pool = new Pool([...ctx.pool.items()], { acquireTimeoutMs: 20 });
  const app = createApp({ pool, config: ctx.config, log: null });
  const held = await Promise.all([pool.acquire(), pool.acquire()]);
  try {
    assertEquals((await app.request("/healthz")).status, 200);
    assertEquals((await app.request("/readyz")).status, 503);
  } finally {
    held.forEach((db) => pool.release(db));
  }
});

Deno.test("OpenAPI describes multipart upload and all operational endpoints", async () => {
  const { app } = await freshContext();
  const doc = await (await app.request("/openapi.json")).json();
  for (const path of ["/healthz", "/readyz", "/ws", "/docs", "/openapi.json"]) {
    assert(doc.paths[path]);
  }
  const body = doc.paths["/api/tasks/{id}/attachment"].post.requestBody;
  assertEquals(
    body.content["multipart/form-data"].schema.properties.file.format,
    "binary",
  );
});
