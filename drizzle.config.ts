// Umut Berke Şenyayla, 2000002240
// Bonus 1: Drizzle Kit reads schema.ts and writes SQL migration files to ./drizzle.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: "file:./tasks.db" },
});
