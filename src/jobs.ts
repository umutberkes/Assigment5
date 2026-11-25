// Umut Berke Şenyayla, 2000002240
// Bonus 14: delete tasks that were done more than `days` days ago.
import { and, eq, isNotNull, lt } from "drizzle-orm";
import type { Db } from "./db.ts";
import type { TaskCache } from "./cache.ts";
import { tasks } from "./schema.ts";

export const DAY_SECONDS = 24 * 60 * 60;

/**
 * Remove every task whose status is "done" and that was completed more than `days` days
 * before `now` (Unix seconds). Their attachment files are removed too.
 * Idempotent: a second run finds nothing more to delete. Returns the number of rows removed.
 */
export async function purgeOldDone(
  db: Db,
  days: number,
  options: { now?: number; uploadDir?: string; cache?: TaskCache } = {},
): Promise<number> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const cutoff = now - days * DAY_SECONDS;
  const removed = await db.db.delete(tasks)
    .where(and(
      eq(tasks.status, "done"),
      isNotNull(tasks.completedAt),
      lt(tasks.completedAt, cutoff),
    ))
    .returning({ id: tasks.id, userId: tasks.userId, attachment: tasks.attachment });
  for (const task of removed) await options.cache?.drop(task.userId, task.id);
  if (options.uploadDir) {
    for (const { attachment } of removed) {
      if (!attachment) continue;
      await Deno.remove(`${options.uploadDir}/${attachment}`).catch(() => {});
    }
  }
  return removed.length;
}
