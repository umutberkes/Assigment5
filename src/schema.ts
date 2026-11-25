// STUDENT NAME, STUDENT NUMBER
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const STATUSES = ["todo", "in-progress", "done"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];

// Worked example: the users table.
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // A SQL default runs for every row. A JavaScript Date.now() here would run once.
  createdAt: integer("created_at").notNull().default(sql`(strftime('%s','now'))`),
});

// The sessions table is given: a login makes a row, a token finds it.
export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  expiresAt: integer("expires_at").notNull(),
});

// R2: one task belongs to one user. Times are Unix seconds, like users.created_at.
export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // my own fields: free text notes and an optional due date (YYYY-MM-DD)
    notes: text("notes"),
    dueDate: text("due_date"),
    status: text("status", { enum: STATUSES }).notNull().default("todo"),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("medium"),
    createdAt: integer("created_at").notNull().default(sql`(strftime('%s','now'))`),
    updatedAt: integer("updated_at").notNull().default(sql`(strftime('%s','now'))`),
    // set when the status becomes "done", cleared when it leaves "done"
    completedAt: integer("completed_at"),
  },
  (t) => [
    check("tasks_title_length", sql`length(${t.title}) BETWEEN 1 AND 100`),
    check("tasks_status", sql`${t.status} IN ('todo', 'in-progress', 'done')`),
    check("tasks_priority", sql`${t.priority} IN ('low', 'medium', 'high')`),
    index("idx_tasks_user_status").on(t.userId, t.status),
  ],
);

export type User = typeof users.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
