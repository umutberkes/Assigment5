// Umut Berke Şenyayla, 2000002240
// Bonus 5: fill a database with demo users and tasks. Safe to run twice.
//   deno task seed
import { count, eq } from "drizzle-orm";
import { hashPassword } from "../src/auth.ts";
import { loadConfig } from "../src/config.ts";
import { createDb, type Db, migrateDatabase } from "../src/db.ts";
import {
  type NewTask,
  type Priority,
  type Role,
  type Status,
  tasks,
  users,
} from "../src/schema.ts";

export const DEMO_PASSWORD = "demo-password-2026";

export const DEMO_USERS: { email: string; role: Role }[] = [
  { email: "alice@example.com", role: "user" },
  { email: "bob@example.com", role: "user" },
  { email: "admin@example.com", role: "admin" },
];

type Row = [title: string, status: Status, priority: Priority, dueDate: string | null];

const ALICE: Row[] = [
  ["Buy an İstanbulkart for the ferry", "done", "high", null],
  ["Read chapter 5 of Kürk Mantolu Madonna", "in-progress", "medium", "2026-12-05"],
  ["Finish SEN0415 Assignment 5", "in-progress", "high", "2026-12-08"],
  ["Book a table in Kadıköy for Friday", "todo", "low", null],
  ["Return library books", "todo", "medium", "2026-11-30"],
  ["Renew the gym membership", "todo", "low", null],
  ["Prepare slides for the database seminar", "todo", "high", "2026-12-12"],
  ["Call grandma", "done", "medium", null],
  ["Fix the bike's back light", "todo", "low", null],
  ["Write the README log", "in-progress", "high", null],
];

const BOB: Row[] = [
  ["Watch the derby", "done", "high", null],
  ["Learn 20 new German words", "in-progress", "medium", null],
  ["Pay the electricity bill", "todo", "high", "2026-11-28"],
  ["Clean the balcony", "todo", "low", null],
  ["Send the internship CV", "in-progress", "high", "2026-12-01"],
  ["Try the new simit place", "todo", "low", null],
  ["Back up the laptop", "todo", "medium", null],
  ["Plan the Bozcaada trip", "todo", "medium", "2027-05-01"],
];

const TASKS: Record<string, Row[]> = {
  "alice@example.com": ALICE,
  "bob@example.com": BOB,
};

/** Returns what was created; a second run creates nothing. */
export async function seed(db: Db): Promise<{ users: number; tasks: number }> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const createdUsers = await db.db.insert(users)
    .values(DEMO_USERS.map((u) => ({ ...u, passwordHash })))
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });

  let createdTasks = 0;
  for (const [email, rows] of Object.entries(TASKS)) {
    const [user] = await db.db.select({ id: users.id }).from(users).where(
      eq(users.email, email),
    );
    if (!user) continue;
    const [has] = await db.db.select({ n: count() }).from(tasks).where(
      eq(tasks.userId, user.id),
    );
    if ((has?.n ?? 0) > 0) continue; // this user already has tasks: leave them alone
    const now = Math.floor(Date.now() / 1000);
    const values: NewTask[] = rows.map(([title, status, priority, dueDate], i) => ({
      userId: user.id,
      title,
      status,
      priority,
      dueDate,
      createdAt: now - (rows.length - i) * 3600, // spread over the last hours, oldest first
      completedAt: status === "done" ? now - 1800 : null,
    }));
    createdTasks += (await db.db.insert(tasks).values(values).returning({ id: tasks.id }))
      .length;
  }
  return { users: createdUsers.length, tasks: createdTasks };
}

if (import.meta.main) {
  const config = loadConfig(Deno.env.toObject());
  if (config.APP_ENV === "production") {
    console.error("refusing to seed: APP_ENV is production");
    Deno.exit(1);
  }
  const db = createDb(config.DATABASE_URL, { authToken: config.DATABASE_AUTH_TOKEN });
  await migrateDatabase(db);
  const created = await seed(db);
  console.log(
    `seed: ${created.users} users and ${created.tasks} tasks created in ${config.DATABASE_URL}`,
  );
  console.log(`log in as alice@example.com, bob@example.com or admin@example.com`);
  console.log(`with the password ${DEMO_PASSWORD}`);
}
