// STUDENT NAME, STUDENT NUMBER
// Bonus 3: counts per status, written the naive way and the good way.
import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./db.ts";
import { type Role, STATUSES, type Status, tasks, users } from "./schema.ts";

export type Summary = Record<Status, number> & { total: number };

const empty = (): Summary => ({ "todo": 0, "in-progress": 0, "done": 0, total: 0 });
const live = (userId: number) => and(eq(tasks.userId, userId), isNull(tasks.deletedAt));

/** Naive: load every task of the user, then one more COUNT query per status. */
export async function summaryNaive(db: Db, userId: number): Promise<Summary> {
  const all = await db.db.select().from(tasks).where(live(userId));
  const out = empty();
  out.total = all.length;
  for (const status of STATUSES) {
    const [row] = await db.db.select({ n: count() }).from(tasks)
      .where(and(live(userId), eq(tasks.status, status)));
    out[status] = row?.n ?? 0;
  }
  return out;
}

/** Good: one GROUP BY query, whatever the number of tasks. */
export async function summaryGrouped(db: Db, userId: number): Promise<Summary> {
  const rows = await db.db.select({ status: tasks.status, n: count() })
    .from(tasks).where(live(userId)).groupBy(tasks.status);
  const out = empty();
  for (const { status, n } of rows) {
    out[status] = n;
    out.total += n;
  }
  return out;
}

export type UserRow = { id: number; email: string; role: Role; createdAt: number; tasks: number };

/** The real N+1: one query for the users, then one query PER USER for the task count. */
export async function usersWithCountsNaive(db: Db): Promise<UserRow[]> {
  const list = await db.db.select({
    id: users.id,
    email: users.email,
    role: users.role,
    createdAt: users.createdAt,
  }).from(users).orderBy(users.id);
  const out: UserRow[] = [];
  for (const u of list) {
    const [row] = await db.db.select({ n: count() }).from(tasks)
      .where(and(eq(tasks.userId, u.id), isNull(tasks.deletedAt)));
    out.push({ ...u, tasks: row?.n ?? 0 });
  }
  return out;
}

/** One LEFT JOIN with GROUP BY: one query for any number of users. */
export async function usersWithCounts(db: Db): Promise<UserRow[]> {
  return await db.db.select({
    id: users.id,
    email: users.email,
    role: users.role,
    createdAt: users.createdAt,
    tasks: sql<number>`count(${tasks.id})`.mapWith(Number),
  }).from(users)
    .leftJoin(tasks, and(eq(tasks.userId, users.id), isNull(tasks.deletedAt)))
    .groupBy(users.id)
    .orderBy(users.id);
}
