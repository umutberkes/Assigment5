// Umut Berke Şenyayla, 2000002240
// Bonus 4: show the query plan and the time of the list query, without and with the index.
//   deno task explain
// It uses its own temporary database, so it never touches tasks.db.
import { createDb, migrate } from "../src/db.ts";
import { tasks, users } from "../src/schema.ts";
import { STATUSES } from "../src/schema.ts";

const USERS = 20;
const TASKS = 20_000;
const RUNS = 200;
const QUERY =
  "SELECT * FROM tasks WHERE user_id = ? AND status = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20";

const db = createDb(`file:${await Deno.makeTempFile({ suffix: ".db" })}`);
await migrate(db);
await db.client.execute("DROP INDEX IF EXISTS idx_tasks_user_status_created"); // start without it

for (let u = 1; u <= USERS; u++) {
  await db.db.insert(users).values({ email: `user${u}@example.com`, passwordHash: "x" });
}
const BATCH = 500;
for (let i = 0; i < TASKS; i += BATCH) {
  await db.db.insert(tasks).values(Array.from({ length: BATCH }, (_, j) => {
    const n = i + j;
    return { userId: (n % USERS) + 1, title: `task ${n}`, status: STATUSES[n % 3]! };
  }));
}
console.log(`${TASKS} tasks for ${USERS} users`);

async function plan(label: string) {
  const res = await db.client.execute({
    sql: `EXPLAIN QUERY PLAN ${QUERY}`,
    args: [7, "done"],
  });
  console.log(`\n${label}: EXPLAIN QUERY PLAN`);
  for (const row of res.rows) console.log(`  ${row.detail}`);
}

async function time(label: string) {
  await db.client.execute({ sql: QUERY, args: [7, "done"] }); // warm up
  const start = performance.now();
  for (let i = 0; i < RUNS; i++) {
    await db.client.execute({ sql: QUERY, args: [(i % USERS) + 1, STATUSES[i % 3]!] });
  }
  const ms = (performance.now() - start) / RUNS;
  console.log(`${label}: ${ms.toFixed(3)} ms per query (average of ${RUNS})`);
}

await plan("1. no index");
await time("1. no index");

await db.client.execute("CREATE INDEX idx_two ON tasks (user_id, status)");
await plan("2. index on (user_id, status)");
await time("2. index on (user_id, status)");

await db.client.execute("DROP INDEX idx_two");
await db.client.execute(
  "CREATE INDEX idx_tasks_user_status_created ON tasks (user_id, status, created_at)",
);
await plan("3. index on (user_id, status, created_at), the one in schema.ts");
await time("3. index on (user_id, status, created_at)");

const size = await db.client.execute(
  "SELECT name, SUM(pgsize) AS bytes FROM dbstat WHERE name IN ('tasks', 'idx_tasks_user_status_created') GROUP BY name",
).catch(() => null);
if (size) {
  console.log("\nsize on disk:");
  for (const row of size.rows) console.log(`  ${row.name}: ${row.bytes} bytes`);
}
