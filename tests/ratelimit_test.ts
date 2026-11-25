// Umut Berke Şenyayla, 2000002240
// Bonus 15: rate limit on login.
import { assertEquals } from "@std/assert";
import { LoginLimiter } from "../src/ratelimit.ts";
import { freshApp, PASSWORD, send } from "./helpers.ts";

const EMAIL = "alice@example.com";

Deno.test("five failures, then the sixth try is 429 with Retry-After, even with the right password", async () => {
  let clock = 1_000_000;
  const app = await freshApp({ limiter: new LoginLimiter(5, 60_000, () => clock) });
  await send(app, "POST", "/auth/register", { email: EMAIL, password: PASSWORD });
  for (let i = 1; i <= 5; i++) {
    const res = await send(app, "POST", "/auth/login", {
      email: EMAIL,
      password: "wrong-one",
    });
    assertEquals(res.status, 401, `try ${i}`);
  }
  clock += 10_000; // ten seconds later
  const sixth = await send(app, "POST", "/auth/login", {
    email: EMAIL,
    password: PASSWORD,
  });
  assertEquals(sixth.status, 429);
  assertEquals(sixth.headers.get("retry-after"), "50");
  assertEquals((await sixth.json()).error, "too many failed logins, try again later");

  // another email is not affected
  const other = await send(app, "POST", "/auth/login", {
    email: "bob@example.com",
    password: "x".repeat(8),
  });
  assertEquals(other.status, 401);

  // after the window the right password works again
  clock += 51_000;
  const later = await send(app, "POST", "/auth/login", {
    email: EMAIL,
    password: PASSWORD,
  });
  assertEquals(later.status, 200);
});

Deno.test("a successful login clears the counter", () => {
  const limiter = new LoginLimiter(5, 60_000, () => 0);
  for (let i = 0; i < 4; i++) limiter.recordFailure(EMAIL);
  limiter.reset(EMAIL);
  for (let i = 0; i < 4; i++) limiter.recordFailure(EMAIL);
  assertEquals(limiter.retryAfter(EMAIL), 0); // 4 failures, not 8
  limiter.recordFailure(EMAIL);
  assertEquals(limiter.retryAfter(EMAIL), 60);
});

Deno.test("the email is compared in lower case, so capitals do not get extra tries", async () => {
  const app = await freshApp({ limiter: new LoginLimiter(2, 60_000, () => 0) });
  await send(app, "POST", "/auth/login", {
    email: "Alice@Example.com",
    password: "wrong-one",
  });
  await send(app, "POST", "/auth/login", {
    email: "ALICE@EXAMPLE.COM",
    password: "wrong-one",
  });
  const res = await send(app, "POST", "/auth/login", {
    email: EMAIL,
    password: "wrong-one",
  });
  assertEquals(res.status, 429);
});
