// Umut Berke Şenyayla, 2000002240
// Bonus 16: cache single tasks in Deno KV for 60 seconds.
import type { Task } from "./schema.ts";

export const CACHE_MS = 60_000;

export class TaskCache {
  hits = 0;
  misses = 0;
  constructor(private readonly kv: Deno.Kv, private readonly ttlMs = CACHE_MS) {}

  /** The owner is part of the key, so one user can never read another user's entry. */
  static key(userId: number, id: number): Deno.KvKey {
    return ["task", userId, id];
  }

  /** Return the cached task, or load it, store it and return it. Misses are not cached. */
  async getOrLoad(
    userId: number,
    id: number,
    load: () => Promise<Task | undefined>,
  ): Promise<Task | undefined> {
    const key = TaskCache.key(userId, id);
    const revisionKey: Deno.KvKey = ["task-revision", userId, id];
    const revision = await this.kv.get<string>(revisionKey);
    const hit = await this.kv.get<Task>(key);
    if (hit.value) {
      this.hits++;
      return hit.value;
    }
    this.misses++;
    const row = await load();
    if (row) {
      // Do not repopulate a stale value if a mutation invalidated this key during load().
      await this.kv.atomic().check(revision)
        .set(key, row, { expireIn: this.ttlMs }).commit();
    }
    return row;
  }

  /** Call after every change to the task. */
  async drop(userId: number, id: number): Promise<void> {
    await this.kv.atomic().delete(TaskCache.key(userId, id))
      .set(["task-revision", userId, id], crypto.randomUUID()).commit();
  }
}
