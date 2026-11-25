// Umut Berke Şenyayla, 2000002240
import { assertEquals } from "@std/assert";
import { createDb, migrateFromFolder } from "../src/db.ts";
Deno.test("generated migrations upgrade existing rows and are safe to run twice", async () => {
  const dir = await Deno.makeTempDir();
  const db = createDb(`file:${dir}/test.db`);
  const journal = JSON.parse(await Deno.readTextFile("drizzle/meta/_journal.json"));
  const first = `${dir}/initial`;
  await Deno.mkdir(`${first}/meta`, { recursive: true });
  const initial = journal.entries[0];
  await Deno.copyFile(`drizzle/${initial.tag}.sql`, `${first}/${initial.tag}.sql`);
  await Deno.writeTextFile(
    `${first}/meta/_journal.json`,
    JSON.stringify({ ...journal, entries: [initial] }),
  );
  try {
    await migrateFromFolder(db, first);
    await db.client.execute(
      "INSERT INTO users(email,password_hash) VALUES ('upgrade@example.com','test')",
    );
    await db.client.execute("INSERT INTO tasks(user_id,title) VALUES(1,'keep me')");
    await migrateFromFolder(db);
    await migrateFromFolder(db);
    const result = await db.client.execute("SELECT title,estimate_minutes FROM tasks");
    assertEquals(result.rows.map((r) => [r.title, r.estimate_minutes]), [[
      "keep me",
      null,
    ]]);
    const count = await db.client.execute(
      "SELECT count(*) AS n FROM __drizzle_migrations",
    );
    assertEquals(Number(count.rows[0]!.n), 2);
  } finally {
    db.client.close();
    await Deno.remove(dir, { recursive: true });
  }
});
