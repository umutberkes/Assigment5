// Umut Berke Şenyayla, 2000002240
// Trusted operator command: public registration always creates a normal user.
import { eq } from "drizzle-orm";
import { loadConfig } from "../src/config.ts";
import { createDb, migrateDatabase } from "../src/db.ts";
import { users } from "../src/schema.ts";
const email = Deno.args[0]?.trim().toLowerCase();
if (!email || !email.includes("@")) {
  throw new Error("Usage: deno task admin existing@email.com");
}
const config = loadConfig(Deno.env.toObject());
const db = createDb(config.DATABASE_URL, { authToken: config.DATABASE_AUTH_TOKEN });
try {
  await migrateDatabase(db);
  const rows = await db.db.update(users).set({ role: "admin" }).where(
    eq(users.email, email),
  )
    .returning({ email: users.email });
  if (!rows.length) throw new Error("Register the user first; no account was changed.");
  console.log(`Promoted ${rows[0]!.email}. Log in again to refresh a JWT role claim.`);
} finally {
  db.client.close();
}
