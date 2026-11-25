// Umut Berke Şenyayla, 2000002240
// Bonus 14: the purge job, tested as a plain function.
import { assertEquals } from "@std/assert";
import { createDb, migrate } from "../src/db.ts";
import { DAY_SECONDS, purgeOldDone } from "../src/jobs.ts";
import { tasks, users } from "../src/schema.ts";

const NOW = 1_800_000_000; // a fixed "now", so the test does not depend on the clock

Deno.test("purgeOldDone removes only done tasks completed more than 30 days ago, and is idempotent", async () => {
  const db = createDb(`file:${await Deno.makeTempFile({ suffix: ".db" })}`);
  await migrate(db);
  await db.db.insert(users).values({ email: "a@example.com", passwordHash: "x" });
  const ago = (days: number) => NOW - days * DAY_SECONDS;
  await db.db.insert(tasks).values([
    { userId: 1, title: "old done", status: "done", completedAt: ago(45) },
    { userId: 1, title: "exactly 30 days", status: "done", completedAt: ago(30) },
    { userId: 1, title: "recent done", status: "done", completedAt: ago(5) },
    { userId: 1, title: "old but not done", status: "todo", completedAt: null },
    { userId: 1, title: "old, reopened", status: "in-progress", completedAt: ago(90) },
  ]);

  const first = await purgeOldDone(db, 30, { now: NOW });
  const second = await purgeOldDone(db, 30, { now: NOW });
  assertEquals([first, second], [1, 0]);

  const left = (await db.db.select({ title: tasks.title }).from(tasks)).map((t) =>
    t.title
  );
  assertEquals(left.sort(), [
    "exactly 30 days",
    "old but not done",
    "old, reopened",
    "recent done",
  ]);
});

Deno.test("purgeOldDone also removes the attachment files of the purged tasks", async () => {
  const db = createDb(`file:${await Deno.makeTempFile({ suffix: ".db" })}`);
  await migrate(db);
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/old.png`, "x");
  await Deno.writeTextFile(`${dir}/keep.png`, "x");
  await db.db.insert(users).values({ email: "a@example.com", passwordHash: "x" });
  await db.db.insert(tasks).values([
    {
      userId: 1,
      title: "old",
      status: "done",
      completedAt: NOW - 40 * DAY_SECONDS,
      attachment: "old.png",
    },
    { userId: 1, title: "new", status: "done", completedAt: NOW, attachment: "keep.png" },
  ]);
  assertEquals(await purgeOldDone(db, 30, { now: NOW, uploadDir: dir }), 1);
  assertEquals([...Deno.readDirSync(dir)].map((e) => e.name), ["keep.png"]);
});
