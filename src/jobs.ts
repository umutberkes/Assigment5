// STUDENT NAME, STUDENT NUMBER
// Bonus 14: delete tasks that were done more than `days` days ago.
import { and, eq, isNotNull, lte } from "drizzle-orm";
import type { Db } from "./db.ts";
import { tasks } from "./schema.ts";

export const DAY_SECONDS = 24 * 60 * 60;

/**
 * Remove every task whose status is "done" and that was completed at least `days` days
 * before `now` (Unix seconds). Their attachment files are removed too.
 * Idempotent: a second run finds nothing more to delete. Returns the number of rows removed.
 */
export async function purgeOldDone(
  db: Db,
  days: number,
  options: { now?: number; uploadDir?: string } = {},
): Promise<number> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const cutoff = now - days * DAY_SECONDS;
  const removed = await db.db.delete(tasks)
    .where(and(
      eq(tasks.status, "done"),
      isNotNull(tasks.completedAt),
      lte(tasks.completedAt, cutoff),
    ))
    .returning({ id: tasks.id, attachment: tasks.attachment });
  if (options.uploadDir) {
    for (const { attachment } of removed) {
      if (!attachment) continue;
      await Deno.remove(`${options.uploadDir}/${attachment}`).catch(() => {});
    }
  }
  return removed.length;
}
