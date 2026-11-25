// STUDENT NAME, STUDENT NUMBER
// Bonus 16: a cache with Deno KV (the test task runs with --unstable-kv).
import { assertEquals } from "@std/assert";
import { TaskCache } from "../src/cache.ts";
import { freshApp, loginAs, makeTask, send } from "./helpers.ts";

async function withCache(fn: (cache: TaskCache) => Promise<void>) {
  const kv = await Deno.openKv(":memory:");
  try {
    await fn(new TaskCache(kv));
  } finally {
    kv.close();
  }
}

Deno.test("the second read is a cache hit: one miss, one hit", () =>
  withCache(async (cache) => {
    const app = await freshApp({ cache });
    const token = await loginAs(app, "alice@example.com");
    const task = await makeTask(app, token, { title: "cached" });
    const a = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
    const b = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
    assertEquals(await a.json(), await b.json());
    assertEquals([cache.misses, cache.hits], [1, 1]);
  }));

Deno.test("a changed task is not served stale (PUT and DELETE clear the entry)", () =>
  withCache(async (cache) => {
    const app = await freshApp({ cache });
    const token = await loginAs(app, "alice@example.com");
    const task = await makeTask(app, token, { title: "before" });
    await send(app, "GET", `/api/tasks/${task.id}`, undefined, token); // now cached
    await send(app, "PUT", `/api/tasks/${task.id}`, { title: "after" }, token);
    const got = await (await send(app, "GET", `/api/tasks/${task.id}`, undefined, token)).json();
    assertEquals(got.title, "after");

    await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, token);
    const gone = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
    assertEquals(gone.status, 404);
  }));

Deno.test("the key includes the user: B never gets A's cached task", () =>
  withCache(async (cache) => {
    const app = await freshApp({ cache });
    const a = await loginAs(app, "alice@example.com");
    const b = await loginAs(app, "bob@example.com");
    const task = await makeTask(app, a, { title: "private" });
    await send(app, "GET", `/api/tasks/${task.id}`, undefined, a); // cached for A
    const res = await send(app, "GET", `/api/tasks/${task.id}`, undefined, b);
    assertEquals(res.status, 404);
    assertEquals(TaskCache.key(1, task.id), ["task", 1, task.id]);
  }));

Deno.test("a miss for an unknown id is not cached", () =>
  withCache(async (cache) => {
    const app = await freshApp({ cache });
    const token = await loginAs(app, "alice@example.com");
    await send(app, "GET", "/api/tasks/999", undefined, token);
    await send(app, "GET", "/api/tasks/999", undefined, token);
    assertEquals([cache.misses, cache.hits], [2, 0]);
  }));
