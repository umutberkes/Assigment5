// STUDENT NAME, STUDENT NUMBER
// Bonus 4 and Bonus 5: the index is used, and the seed script is safe to run twice.
import { assertEquals, assertStringIncludes } from "@std/assert";
import { count, eq } from "drizzle-orm";
import { createDb, migrate } from "../src/db.ts";
import { tasks, users } from "../src/schema.ts";
import { DEMO_PASSWORD, seed } from "../scripts/seed.ts";
import { freshContext, send } from "./helpers.ts";

Deno.test("the list query uses the index from migrate()", async () => {
  const db = createDb(`file:${await Deno.makeTempFile({ suffix: ".db" })}`);
  await migrate(db);
  const res = await db.client.execute({
    sql: "EXPLAIN QUERY PLAN SELECT * FROM tasks WHERE user_id = ? AND status = ? " +
      "ORDER BY created_at DESC LIMIT 20",
    args: [1, "done"],
  });
  const plan = res.rows.map((r) => String(r.detail)).join("\n");
  assertStringIncludes(plan, "USING INDEX idx_tasks_user_status_created");
  assertEquals(plan.includes("TEMP B-TREE"), false); // no extra sort step
});

Deno.test("seed fills an empty database, and a second run creates nothing", async () => {
  const db = createDb(`file:${await Deno.makeTempFile({ suffix: ".db" })}`);
  await migrate(db);
  const first = await seed(db);
  const second = await seed(db);
  assertEquals(first, { users: 3, tasks: 18 });
  assertEquals(second, { users: 0, tasks: 0 });
  const [n] = await db.db.select({ n: count() }).from(tasks);
  assertEquals(n?.n, 18);
  const [admin] = await db.db.select().from(users).where(eq(users.email, "admin@example.com"));
  assertEquals(admin?.role, "admin");
});

Deno.test("a seeded demo user can log in through the API and sees their tasks", async () => {
  const { app, pool } = await freshContext();
  await pool.use((db) => seed(db));
  const res = await send(app, "POST", "/auth/login", {
    email: "alice@example.com",
    password: DEMO_PASSWORD,
  });
  assertEquals(res.status, 200);
  const { token } = await res.json();
  const list = await (await send(app, "GET", "/api/tasks", undefined, token)).json();
  assertEquals(list.total, 10);
});
