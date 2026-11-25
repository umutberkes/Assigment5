// STUDENT NAME, STUDENT NUMBER
// Bonus 3: print the SQL that the naive and the good versions send.
//   deno task n+1
import type { Logger } from "drizzle-orm";
import { createDb, migrate } from "../src/db.ts";
import { tasks, users } from "../src/schema.ts";
import {
  summaryGrouped,
  summaryNaive,
  usersWithCounts,
  usersWithCountsNaive,
} from "../src/summary.ts";

class PrintLogger implements Logger {
  count = 0;
  quiet = true; // not while the demo data is inserted
  logQuery(query: string, params: unknown[]): void {
    if (this.quiet) return;
    this.count++;
    console.log(`  [${this.count}] ${query}${params.length ? `  -- ${JSON.stringify(params)}` : ""}`);
  }
}

const logger = new PrintLogger();
const db = createDb(`file:${await Deno.makeTempFile({ suffix: ".db" })}`, { logger });
await migrate(db);
for (let u = 1; u <= 5; u++) {
  await db.db.insert(users).values({ email: `user${u}@example.com`, passwordHash: "x" });
  await db.db.insert(tasks).values(
    Array.from({ length: 4 }, (_, i) => ({ userId: u, title: `t${i}` })),
  );
}

logger.quiet = false;

async function show(label: string, run: () => Promise<unknown>) {
  console.log(`\n${label}`);
  logger.count = 0;
  const result = await run();
  console.log(`  => ${logger.count} queries, result: ${JSON.stringify(result)}`);
}

await show("users with task counts, naive (5 users):", () => usersWithCountsNaive(db));
await show("users with task counts, LEFT JOIN + GROUP BY:", () => usersWithCounts(db));
await show("my summary, naive:", () => summaryNaive(db, 1));
await show("my summary, GROUP BY:", () => summaryGrouped(db, 1));
