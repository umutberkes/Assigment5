// STUDENT NAME, STUDENT NUMBER
// Bonus 11: read the environment once, validate it, and stop with a clear message.
import { z } from "zod";

export const DEV_SECRET = "dev-secret";

const Env = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  DATABASE_URL: z.string().regex(/^(file:|libsql:|https?:)/, "must start with file:, libsql: or https:")
    .default("file:./tasks.db"),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(32).default(4),
  AUTH_MODE: z.enum(["session", "jwt"]).default("session"),
  JWT_SECRET: z.string().min(1).default(DEV_SECRET),
  ADMIN_EMAIL: z.email().transform((e) => e.toLowerCase()).optional(),
  UPLOAD_DIR: z.string().min(1).default("./uploads"),
  LOG_REQUESTS: z.stringbool().default(true),
}).superRefine((env, ctx) => {
  if (env.APP_ENV !== "production") return;
  const weak = env.JWT_SECRET === DEV_SECRET || env.JWT_SECRET === "change-me" ||
    env.JWT_SECRET.length < 32;
  if (weak) {
    ctx.addIssue({
      code: "custom",
      path: ["JWT_SECRET"],
      message: "in production JWT_SECRET must be set to a random value of 32+ characters",
    });
  }
  if (env.DATABASE_URL.startsWith("libsql:") && !env.DATABASE_AUTH_TOKEN) {
    ctx.addIssue({
      code: "custom",
      path: ["DATABASE_AUTH_TOKEN"],
      message: "a remote libsql database needs DATABASE_AUTH_TOKEN",
    });
  }
});

export type Config = z.output<typeof Env>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Validate a plain record of environment variables (empty strings count as missing). */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ""),
  );
  const result = Env.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`invalid configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

/** A configuration for tests: everything has a safe default. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({ APP_ENV: "test", LOG_REQUESTS: "false" }), ...overrides };
}
