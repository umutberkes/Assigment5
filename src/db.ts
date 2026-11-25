// STUDENT NAME, STUDENT NUMBER
import { drizzle } from "drizzle-orm/libsql";
import { migrate as drizzleMigrate } from "drizzle-orm/libsql/migrator";
import { createClient } from "@libsql/client";
import type { Logger } from "drizzle-orm";
import * as schema from "./schema.ts";
import { Pool } from "./pool.ts";

export type Db = ReturnType<typeof createDb>;
export type DbPool = Pool<Db>;

export type DbOptions = { authToken?: string; logger?: Logger | boolean };

/** Open one connection. A local file URL, or a remote libsql:// URL with a token (Bonus 19). */
export function createDb(url: string, options: DbOptions = {}) {
  const client = createClient({ url, authToken: options.authToken });
  const db = drizzle(client, { schema, logger: options.logger ?? false });
  return { db, client };
}

/**
 * Bonus 6, option B: open `size` connections to the same database and put them in a pool.
 * For a local file every connection uses WAL (readers do not block the writer) and waits up
 * to 5 s for a lock instead of failing at once. An in-memory database is private to its
 * connection, and a remote database is reached over HTTP, so both get exactly one.
 */
export async function createDbPool(
  url: string,
  size: number,
  options: DbOptions & { acquireTimeoutMs?: number } = {},
): Promise<DbPool> {
  const local = url.startsWith("file:") && !url.includes(":memory:");
  const count = local ? size : 1;
  const dbs: Db[] = [];
  for (let i = 0; i < count; i++) {
    const db = createDb(url, options);
    if (local) {
      await db.client.execute("PRAGMA journal_mode=WAL");
      await db.client.execute("PRAGMA busy_timeout=5000");
      await db.client.execute("PRAGMA foreign_keys=ON");
    }
    dbs.push(db);
  }
  return new Pool(dbs, { acquireTimeoutMs: options.acquireTimeoutMs });
}

/** The SQL that creates every table. Keep this in sync with schema.ts. */
export const CREATE_TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     email TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     role TEXT NOT NULL DEFAULT 'user',
     created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
     CONSTRAINT users_role CHECK (role IN ('user', 'admin'))
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id),
     expires_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS tasks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     notes TEXT,
     due_date TEXT,
     status TEXT NOT NULL DEFAULT 'todo',
     priority TEXT NOT NULL DEFAULT 'medium',
     created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
     updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
     completed_at INTEGER,
     deleted_at INTEGER,
     attachment TEXT,
     attachment_type TEXT,
     CONSTRAINT tasks_title_length CHECK (length(title) BETWEEN 1 AND 100),
     CONSTRAINT tasks_status CHECK (status IN ('todo', 'in-progress', 'done')),
     CONSTRAINT tasks_priority CHECK (priority IN ('low', 'medium', 'high'))
   )`,
  // Bonus 4: the list query filters by owner and status and sorts by created_at
  `CREATE INDEX IF NOT EXISTS idx_tasks_user_status_created
     ON tasks (user_id, status, created_at)`,
];

/** Create the tables if they do not exist yet. */
export async function migrate({ client }: Db) {
  await client.batch(CREATE_TABLES);
}

/**
 * Bonus 1: apply the SQL files that Drizzle Kit generated from schema.ts
 * (deno task db:generate). Drizzle keeps track of what already ran in __drizzle_migrations.
 */
export async function migrateFromFolder({ db }: Db, migrationsFolder = "./drizzle") {
  await drizzleMigrate(db, { migrationsFolder });
}

/** True when generated migrations exist; then main.ts uses them instead of CREATE_TABLES. */
export async function hasGeneratedMigrations(folder = "./drizzle"): Promise<boolean> {
  try {
    return (await Deno.stat(`${folder}/meta/_journal.json`)).isFile;
  } catch {
    return false;
  }
}
