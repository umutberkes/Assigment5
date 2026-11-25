// STUDENT NAME, STUDENT NUMBER
// Bonus 3: the summary numbers, and how many queries each version sends.
import { assertEquals } from "@std/assert";
import type { Logger } from "drizzle-orm";
import { createDb, migrate } from "../src/db.ts";
import { tasks, users } from "../src/schema.ts";
import {
  summaryGrouped,
  summaryNaive,
  usersWithCounts,
  usersWithCountsNaive,
} from "../src/summary.ts";
import { freshApp, loginAs, makeTask, send } from "./helpers.ts";

Deno.test("GET /api/me/summary counts my tasks per status (deleted ones not counted)", async () => {
  const app = await freshApp();
  const token = await loginAs(app, "alice@example.com"); // + 1 welcome task (todo)
  await makeTask(app, token, { title: "a", status: "done" });
  await makeTask(app, token, { title: "b", status: "done" });
  await makeTask(app, token, { title: "c", status: "in-progress" });
  const gone = await makeTask(app, token, { title: "d", status: "in-progress" });
  await send(app, "DELETE", `/api/tasks/${gone.id}`, undefined, token);
  const other = await loginAs(app, "bob@example.com");
  await makeTask(app, other, { title: "not mine", status: "done" });

  const res = await send(app, "GET", "/api/me/summary", undefined, token);
  assertEquals(await res.json(), { "todo": 1, "in-progress": 1, "done": 2, "total": 4 });
});

class CountingLogger implements Logger {
  queries: string[] = [];
  logQuery(query: string): void {
    this.queries.push(query);
  }
}

async function dbWithUsers(userCount: number, tasksEach: number) {
  const logger = new CountingLogger();
  const db = createDb(`file:${await Deno.makeTempFile({ suffix: ".db" })}`, { logger });
  await migrate(db);
  for (let u = 1; u <= userCount; u++) {
    await db.db.insert(users).values({ email: `u${u}@example.com`, passwordHash: "x" });
    await db.db.insert(tasks).values(
      Array.from({ length: tasksEach }, (_, i) => ({ userId: u, title: `task ${i}` })),
    );
  }
  logger.queries.length = 0; // count only what comes next
  return { db, logger };
}

Deno.test("N+1: the naive user list sends 1 + N queries, the join sends 1", async () => {
  for (const n of [3, 10]) {
    const { db, logger } = await dbWithUsers(n, 2);
    const naive = await usersWithCountsNaive(db);
    const naiveQueries = logger.queries.length;
    logger.queries.length = 0;
    const good = await usersWithCounts(db);
    assertEquals(naiveQueries, n + 1);
    assertEquals(logger.queries.length, 1);
    assertEquals(good, naive); // same answer
  }
});

Deno.test("summary: the naive version sends 4 queries and loads every row, GROUP BY sends 1", async () => {
  const { db, logger } = await dbWithUsers(1, 50);
  const naive = await summaryNaive(db, 1);
  assertEquals(logger.queries.length, 4);
  logger.queries.length = 0;
  const good = await summaryGrouped(db, 1);
  assertEquals(logger.queries.length, 1);
  assertEquals(good, naive);
  assertEquals(good.total, 50);
});
