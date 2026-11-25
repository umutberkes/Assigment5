// Umut Berke Şenyayla, 2000002240
// Bonus 6, option B: my own pool.
import { assertEquals, assertRejects } from "@std/assert";
import { Pool, PoolTimeoutError } from "../src/pool.ts";
import { createDbPool, migrate } from "../src/db.ts";
import { users } from "../src/schema.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.test("20 jobs on a pool of 3: never more than 3 at once, and all 20 finish", async () => {
  const pool = new Pool(["c1", "c2", "c3"]);
  let running = 0;
  let maxRunning = 0;
  const finished: string[] = [];
  const jobs = Array.from({ length: 20 }, (_, i) =>
    pool.use(async (conn) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await sleep(5 + (i % 4) * 3);
      running--;
      finished.push(conn);
      return i;
    }));
  const results = await Promise.all(jobs);
  assertEquals(maxRunning, 3);
  assertEquals(results, Array.from({ length: 20 }, (_, i) => i));
  assertEquals(finished.length, 20);
  assertEquals([pool.idle, pool.waiting], [3, 0]);
});

Deno.test("a job that throws still gives its connection back", async () => {
  const pool = new Pool(["only"]);
  await assertRejects(() => pool.use(() => Promise.reject(new Error("boom"))));
  assertEquals(pool.idle, 1);
  assertEquals(await pool.use((c) => Promise.resolve(c)), "only");
});

Deno.test("waiters are served first come, first served", async () => {
  const pool = new Pool(["only"]);
  const held = await pool.acquire();
  const order: number[] = [];
  const a = pool.use(() => Promise.resolve(order.push(1)));
  const b = pool.use(() => Promise.resolve(order.push(2)));
  assertEquals(pool.waiting, 2);
  pool.release(held);
  await Promise.all([a, b]);
  assertEquals(order, [1, 2]);
});

Deno.test("when every connection stays busy, acquire gives up after the timeout", async () => {
  const pool = new Pool(["only"], { acquireTimeoutMs: 30 });
  const held = await pool.acquire();
  await assertRejects(() => pool.acquire(), PoolTimeoutError);
  assertEquals(pool.waiting, 0); // the timed-out waiter left the queue
  pool.release(held);
  assertEquals(pool.idle, 1);
});

Deno.test("a pool of real connections: concurrent writes all land, WAL is on", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const pool = await createDbPool(`file:${file}`, 3);
  await pool.use((db) => migrate(db));
  await Promise.all(
    Array.from(
      { length: 30 },
      (_, i) =>
        pool.use((db) =>
          db.db.insert(users).values({ email: `user${i}@example.com`, passwordHash: "x" })
        ),
    ),
  );
  const rows = await pool.use((db) => db.db.select().from(users));
  assertEquals(rows.length, 30);
  const mode = await pool.use((db) => db.client.execute("PRAGMA journal_mode"));
  assertEquals(String(mode.rows[0]?.journal_mode), "wal");
});
