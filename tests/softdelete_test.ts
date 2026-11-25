// STUDENT NAME, STUDENT NUMBER
// Bonus 2: soft delete, restore and the registration transaction.
import { assertEquals } from "@std/assert";
import { count } from "drizzle-orm";
import { tasks, users } from "../src/schema.ts";
import { freshApp, freshContext, loginAs, makeTask, send, WELCOME_TASKS } from "./helpers.ts";

Deno.test("a deleted task is not listed and not found, but the row is still there", async () => {
  const { app, pool } = await freshContext();
  const token = await loginAs(app, "alice@example.com");
  const task = await makeTask(app, token, { title: "Return library books" });
  await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, token);

  const list = await (await send(app, "GET", "/api/tasks", undefined, token)).json();
  assertEquals(list.total, WELCOME_TASKS);
  const got = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
  assertEquals(got.status, 404);
  const put = await send(app, "PUT", `/api/tasks/${task.id}`, { title: "x" }, token);
  assertEquals(put.status, 404);

  const [row] = await pool.use((db) => db.db.select({ n: count() }).from(tasks));
  assertEquals(row?.n, WELCOME_TASKS + 1); // marked, not removed
});

Deno.test("restore brings a deleted task back; restoring a live task is 404", async () => {
  const app = await freshApp();
  const token = await loginAs(app, "alice@example.com");
  const task = await makeTask(app, token, { title: "Water the plants" });

  const early = await send(app, "POST", `/api/tasks/${task.id}/restore`, undefined, token);
  assertEquals(early.status, 404);

  await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, token);
  const res = await send(app, "POST", `/api/tasks/${task.id}/restore`, undefined, token);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).deletedAt, null);
  const got = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
  assertEquals(got.status, 200);
});

Deno.test("another user cannot restore my deleted task", async () => {
  const app = await freshApp();
  const a = await loginAs(app, "alice@example.com");
  const b = await loginAs(app, "bob@example.com");
  const task = await makeTask(app, a, { title: "Mine" });
  await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, a);
  const res = await send(app, "POST", `/api/tasks/${task.id}/restore`, undefined, b);
  assertEquals(res.status, 404);
});

Deno.test("register creates the user and the welcome task together", async () => {
  const app = await freshApp({ welcomeTitle: "Merhaba!" });
  const token = await loginAs(app, "alice@example.com");
  const list = await (await send(app, "GET", "/api/tasks", undefined, token)).json();
  assertEquals(list.items.map((t: { title: string }) => t.title), ["Merhaba!"]);
});

Deno.test("when the welcome task fails, the user is rolled back too", async () => {
  // An empty title breaks the CHECK constraint on tasks, so the second insert throws.
  const { app, pool } = await freshContext({ welcomeTitle: "" });
  const original = console.error;
  console.error = () => {}; // the 500 handler logs the error; keep the test output clean
  try {
    const res = await send(app, "POST", "/auth/register", {
      email: "alice@example.com",
      password: "kadikoy-1907",
    });
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error, "internal error");
  } finally {
    console.error = original;
  }
  const [u] = await pool.use((db) => db.db.select({ n: count() }).from(users));
  const [t] = await pool.use((db) => db.db.select({ n: count() }).from(tasks));
  assertEquals([u?.n, t?.n], [0, 0]); // nothing left behind
});
