// STUDENT NAME, STUDENT NUMBER
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema.ts";

export type Db = ReturnType<typeof createDb>;

/** Open a database. Tests pass a temporary file. */
export function createDb(url: string) {
  const client = createClient({ url });
  const db = drizzle(client, { schema });
  return { db, client };
}

/**
 * Create the tables if they do not exist yet. Keep this in sync with schema.ts:
 * same table names, column names, defaults, checks and index.
 */
export async function migrate({ client }: Db) {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS users (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       email TEXT NOT NULL UNIQUE,
       password_hash TEXT NOT NULL,
       created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
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
       CONSTRAINT tasks_title_length CHECK (length(title) BETWEEN 1 AND 100),
       CONSTRAINT tasks_status CHECK (status IN ('todo', 'in-progress', 'done')),
       CONSTRAINT tasks_priority CHECK (priority IN ('low', 'medium', 'high'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks (user_id, status)`,
  ]);
}
