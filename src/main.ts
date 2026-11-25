// STUDENT NAME, STUDENT NUMBER
import { createApp } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { createDbPool, migrate } from "./db.ts";
import { TaskCache } from "./cache.ts";
import { purgeOldDone } from "./jobs.ts";

let config;
try {
  config = loadConfig(Deno.env.toObject()); // Bonus 11: validated once, at start-up
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    Deno.exit(1);
  }
  throw err;
}

const pool = await createDbPool(config.DATABASE_URL, config.DB_POOL_SIZE, {
  authToken: config.DATABASE_AUTH_TOKEN,
});
await pool.use((db) => migrate(db));

// Bonus 16: Deno KV for the task cache (needs --unstable-kv when run locally)
const kv = await Deno.openKv();
const app = createApp({ pool, config, cache: new TaskCache(kv) });

// Bonus 14: every night at 03:00 UTC remove tasks that were done more than 30 days ago
Deno.cron("purge old done tasks", "0 3 * * *", async () => {
  const removed = await pool.use((db) =>
    purgeOldDone(db, 30, { uploadDir: config.UPLOAD_DIR })
  );
  console.log(JSON.stringify({ time: new Date().toISOString(), job: "purge", removed }));
});

Deno.serve({ port: config.PORT }, app.fetch);
