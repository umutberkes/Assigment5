// Umut Berke Şenyayla, 2000002240
// Bonus 4: each plan runs on its own copy of the same 20,000-row database.
// Separate files avoid native prepared statements retaining locks across DDL changes.
import { createDb, migrate } from "../src/db.ts";
import { STATUSES, tasks, users } from "../src/schema.ts";
const USERS = 20;
const TASKS = 20_000;
const RUNS = 200;
const QUERY =
  "SELECT * FROM tasks WHERE user_id = ? AND status = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 20";
const dir = await Deno.makeTempDir();
const base = `${dir}/base.db`;
const seed = createDb(`file:${base}`);
await migrate(seed);
await seed.client.execute("DROP INDEX idx_tasks_user_status_created");
for (let u = 1; u <= USERS; u++) {
  await seed.db.insert(users).values({
    email: `user${u}@example.com`,
    passwordHash: "x",
  });
}
for (let i = 0; i < TASKS; i += 500) {
  await seed.db.insert(tasks).values(Array.from({ length: 500 }, (_, j) => {
    const n = i + j;
    return {
      userId: n % USERS + 1,
      title: `task ${n}`,
      status: STATUSES[n % 3]!,
      createdAt: 1_790_000_000 + n,
    };
  }));
}
seed.client.close();
console.log(`${TASKS} tasks for ${USERS} users; identical data in every scenario`);
const cases = [
  { label: "1. no index", index: "" },
  {
    label: "2. index on (user_id, status)",
    index: "CREATE INDEX idx_two ON tasks(user_id,status)",
  },
  {
    label: "3. index on (user_id, status, created_at)",
    index:
      "CREATE INDEX idx_tasks_user_status_created ON tasks(user_id,status,created_at)",
  },
];
try {
  for (const [i, scenario] of cases.entries()) {
    const file = `${dir}/case-${i}.db`;
    await Deno.copyFile(base, file);
    const db = createDb(`file:${file}`);
    try {
      if (scenario.index) await db.client.execute(scenario.index);
      const plan = await db.client.execute({
        sql: `EXPLAIN QUERY PLAN ${QUERY}`,
        args: [7, "done"],
      });
      console.log(`\n${scenario.label}: EXPLAIN QUERY PLAN`);
      for (const row of plan.rows) console.log(`  ${row.detail}`);
      await db.client.execute({ sql: QUERY, args: [7, "done"] });
      const started = performance.now();
      for (let n = 0; n < RUNS; n++) {
        await db.client.execute({ sql: QUERY, args: [n % USERS + 1, STATUSES[n % 3]!] });
      }
      console.log(
        `${scenario.label}: ${
          ((performance.now() - started) / RUNS).toFixed(3)
        } ms per query (average of ${RUNS})`,
      );
      if (i === 2) {
        const size = await db.client.execute(
          "SELECT name,SUM(pgsize) AS bytes FROM dbstat WHERE name IN ('tasks','idx_tasks_user_status_created') GROUP BY name",
        );
        console.log("\nsize on disk:");
        for (const row of size.rows) console.log(`  ${row.name}: ${row.bytes} bytes`);
      }
    } finally {
      db.client.close();
    }
  }
} finally {
  await Deno.remove(dir, { recursive: true });
}
