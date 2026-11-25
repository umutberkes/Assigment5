// Umut Berke Şenyayla, 2000002240
// Bonus 15: after `max` failed logins for one email inside `windowMs`, refuse for a while.

type Entry = { failures: number; resetAt: number };

export class LoginLimiter {
  #entries = new Map<string, Entry>();
  constructor(
    private readonly max = 5,
    private readonly windowMs = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Seconds the caller must wait, or 0 when a login attempt is allowed. */
  retryAfter(email: string): number {
    const e = this.#entries.get(email);
    if (!e) return 0;
    if (e.resetAt <= this.now()) {
      this.#entries.delete(email); // an old window starts again from 0
      return 0;
    }
    return e.failures >= this.max ? Math.ceil((e.resetAt - this.now()) / 1000) : 0;
  }

  recordFailure(email: string): void {
    const e = this.#entries.get(email);
    if (!e || e.resetAt <= this.now()) {
      this.#entries.set(email, { failures: 1, resetAt: this.now() + this.windowMs });
    } else {
      e.failures++;
    }
  }

  /** A successful login clears the counter. */
  reset(email: string): void {
    this.#entries.delete(email);
  }
}
