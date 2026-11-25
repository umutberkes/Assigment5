// STUDENT NAME, STUDENT NUMBER
import { assertEquals } from "@std/assert";
import { freshApp, loginAs, makeTask, send, WELCOME_TASKS } from "./helpers.ts";

Deno.test("create a task: 201 with defaults, then it is in the list", async () => {
  const app = await freshApp();
  const token = await loginAs(app, "alice@example.com");
  const res = await send(app, "POST", "/api/tasks", { title: "Buy a ferry card" }, token);
  assertEquals(res.status, 201);
  const task = await res.json();
  assertEquals([task.title, task.status, task.priority], ["Buy a ferry card", "todo", "medium"]);
  assertEquals(typeof task.createdAt, "number");

  const list = await (await send(app, "GET", "/api/tasks", undefined, token)).json();
  assertEquals(list.total, WELCOME_TASKS + 1);
  assertEquals(list.items[0].id, task.id); // newest first
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
  // deleted twice: the second time it no longer exists
  const again = await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, token);
  assertEquals(again.status, 404);
  const gone = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
  assertEquals(gone.status, 404);
});

Deno.test("PUT keeps the fields it was not given (as the given UI sends only title and status)", async () => {
  const app = await freshApp();
  const token = await loginAs(app, "alice@example.com");
  const task = await makeTask(app, token, {
    title: "Exam",
    priority: "high",
    notes: "room B204",
    dueDate: "2027-01-12",
  });
  const res = await send(app, "PUT", `/api/tasks/${task.id}`, {
    title: "Exam",
    status: "in-progress",
  }, token);
  const t = await res.json();
  assertEquals([t.status, t.priority, t.notes, t.dueDate], [
    "in-progress",
    "high",
    "room B204",
    "2027-01-12",
  ]);
  // null clears a field on purpose
  const cleared = await (await send(app, "PUT", `/api/tasks/${task.id}`, {
    title: "Exam",
    notes: null,
  }, token)).json();
  assertEquals([cleared.notes, cleared.status], [null, "in-progress"]);
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
  // and B's list does not show it (only B's own welcome task)
  const list = await (await send(app, "GET", "/api/tasks", undefined, b)).json();
  assertEquals(list.total, WELCOME_TASKS);
  assertEquals(list.items.some((t: { id: number }) => t.id === task.id), false);
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
    made.push(await makeTask(app, token, { title, status: "in-progress" }));
  }
  // the status filter leaves the welcome task out, so exactly my three tasks are counted
  const url = (page: number) => `/api/tasks?status=in-progress&page=${page}&limit=2`;
  const p1 = await (await send(app, "GET", url(1), undefined, token)).json();
  const p2 = await (await send(app, "GET", url(2), undefined, token)).json();
  assertEquals([p1.items.length, p1.total], [2, 3]);
  assertEquals([p2.items.length, p2.page, p2.limit, p2.total], [1, 2, 2, 3]);
  // newest first: page 1 holds third and second, page 2 holds first
  assertEquals(p1.items.map((t: { title: string }) => t.title), ["third", "second"]);
  assertEquals(p2.items[0].id, made[0]!.id);
  // a page after the end is empty, not an error
  const p3 = await (await send(app, "GET", url(3), undefined, token)).json();
  assertEquals([p3.items.length, p3.total], [0, 3]);
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
  const body = await res.json();
  assertEquals(body.error, "not found");
  assertEquals(body.requestId, res.headers.get("x-request-id"));
});
