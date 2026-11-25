// STUDENT NAME, STUDENT NUMBER
import { assertEquals, assertNotEquals } from "@std/assert";
import { freshApp, loginAs, makeTask, send } from "./helpers.ts";

Deno.test("create a task: 201 with defaults, then it is in the list", async () => {
  const app = await freshApp();
  const token = await loginAs(app, "alice@example.com");
  const res = await send(app, "POST", "/api/tasks", { title: "Buy a ferry card" }, token);
  assertEquals(res.status, 201);
  const task = await res.json();
  assertEquals([task.title, task.status, task.priority], ["Buy a ferry card", "todo", "medium"]);
  assertEquals(typeof task.createdAt, "number");

  const list = await (await send(app, "GET", "/api/tasks", undefined, token)).json();
  assertEquals(list.total, 1);
  assertEquals(list.items[0].id, task.id);
});

Deno.test("read, update and delete my own task", async () => {
  const app = await freshApp();
  const token = await loginAs(app, "alice@example.com");
  const task = await makeTask(app, token, { title: "Read Kar" });

  const got = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
  assertEquals(got.status, 200);

  const put = await send(app, "PUT", `/api/tasks/${task.id}`, {
    title: "Read Kar again",
    status: "done",
    priority: "high",
  }, token);
  assertEquals(put.status, 200);
  const updated = await put.json();
  assertEquals([updated.title, updated.status, updated.priority], [
    "Read Kar again",
    "done",
    "high",
  ]);
  assertEquals(typeof updated.completedAt, "number");

  const del = await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, token);
  assertEquals([del.status, await del.json()], [200, { ok: true }]);
  const gone = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
  assertEquals(gone.status, 404);
});

Deno.test("user B cannot read, change or delete user A's task (404 each)", async () => {
  const app = await freshApp();
  const a = await loginAs(app, "alice@example.com");
  const b = await loginAs(app, "bob@example.com");
  const task = await makeTask(app, a, { title: "Alice's secret" });

  const read = await send(app, "GET", `/api/tasks/${task.id}`, undefined, b);
  const change = await send(app, "PUT", `/api/tasks/${task.id}`, { title: "hacked" }, b);
  const remove = await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, b);
  for (const res of [read, change, remove]) {
    assertEquals(res.status, 404);
    assertEquals((await res.json()).error, "task not found");
  }
  // and B's list does not show it
  const list = await (await send(app, "GET", "/api/tasks", undefined, b)).json();
  assertEquals(list.total, 0);
  // the task is unchanged for A
  const mine = await (await send(app, "GET", `/api/tasks/${task.id}`, undefined, a)).json();
  assertEquals(mine.title, "Alice's secret");
});

Deno.test("an invalid status or a missing title is 400 with the issues", async () => {
  const app = await freshApp();
  const token = await loginAs(app, "alice@example.com");
  const res = await send(app, "POST", "/api/tasks", { status: "finished" }, token);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "validation failed");
  const paths = body.issues.map((i: { path: string[] }) => i.path[0]).sort();
  assertEquals(paths, ["status", "title"]);
});

Deno.test("a title over 100 characters and a bad due date are 400", async () => {
  const app = await freshApp();
  const token = await loginAs(app, "alice@example.com");
  const long = await send(app, "POST", "/api/tasks", { title: "x".repeat(101) }, token);
  const date = await send(app, "POST", "/api/tasks", {
    title: "Exam",
    dueDate: "2026-02-30",
  }, token);
  assertEquals([long.status, date.status], [400, 400]);
});

Deno.test("an id that is not a number is 400, an unknown id is 404", async () => {
  const app = await freshApp();
  const token = await loginAs(app, "alice@example.com");
  const bad = await send(app, "GET", "/api/tasks/abc", undefined, token);
  const unknown = await send(app, "GET", "/api/tasks/999", undefined, token);
  assertEquals([bad.status, unknown.status], [400, 404]);
});

Deno.test("pagination: 3 tasks, page 2 with limit=2 holds one item and total 3", async () => {
  const app = await freshApp();
  const token = await loginAs(app, "alice@example.com");
  const made = [];
  for (const title of ["first", "second", "third"]) {
    made.push(await makeTask(app, token, { title }));
  }
  const p1 = await (await send(app, "GET", "/api/tasks?page=1&limit=2", undefined, token))
    .json();
  const p2 = await (await send(app, "GET", "/api/tasks?page=2&limit=2", undefined, token))
    .json();
  assertEquals([p1.items.length, p1.total], [2, 3]);
  assertEquals([p2.items.length, p2.page, p2.limit, p2.total], [1, 2, 2, 3]);
  // newest first, and no task appears on both pages
  assertEquals(p2.items[0].id, made[0]!.id);
  assertNotEquals(p1.items.map((t: { id: number }) => t.id), p2.items[0].id);
});

Deno.test("filter by status, and the defaults page=1 limit=20", async () => {
  const app = await freshApp();
  const token = await loginAs(app, "alice@example.com");
  await makeTask(app, token, { title: "a", status: "done" });
  await makeTask(app, token, { title: "b" });
  const res = await (await send(app, "GET", "/api/tasks?status=done", undefined, token)).json();
  assertEquals([res.page, res.limit, res.total, res.items[0].title], [1, 20, 1, "a"]);
});

Deno.test("bad query values are 400, not a crash", async () => {
  const app = await freshApp();
  const token = await loginAs(app, "alice@example.com");
  for (const q of ["page=abc", "page=0", "limit=1000", "limit=1.5", "status=finished"]) {
    const res = await send(app, "GET", `/api/tasks?${q}`, undefined, token);
    assertEquals(res.status, 400, q);
    assertEquals((await res.json()).error, "validation failed");
  }
});

Deno.test("an unknown route answers 404 in the same shape", async () => {
  const app = await freshApp();
  const res = await app.request("/no/such/route");
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not found" });
});
