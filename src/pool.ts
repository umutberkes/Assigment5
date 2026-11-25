// STUDENT NAME, STUDENT NUMBER
// Bonus 6, option B: a connection pool of my own, used with SQLite.

export class PoolTimeoutError extends Error {
  override name = "PoolTimeoutError";
}

/**
 * A fixed set of items (here: database connections). acquire() gives an idle item or
 * waits in a first-in first-out queue; release() hands the item straight to the next
 * waiter. use(fn) always gives the item back, even when fn throws.
 */
export class Pool<T> {
  #all: T[];
  #idle: T[];
  #waiting: { resolve: (item: T) => void; timer?: number }[] = [];
  #acquireTimeoutMs: number;

  constructor(items: T[], options: { acquireTimeoutMs?: number } = {}) {
    if (items.length === 0) throw new Error("a pool needs at least one item");
    this.#all = [...items];
    this.#idle = [...items];
    this.#acquireTimeoutMs = options.acquireTimeoutMs ?? 10_000;
  }

  get size() {
    return this.#all.length;
  }
  get idle() {
    return this.#idle.length;
  }
  get waiting() {
    return this.#waiting.length;
  }

  acquire(): Promise<T> {
    const item = this.#idle.pop();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise<T>((resolve, reject) => {
      const waiter: { resolve: (item: T) => void; timer?: number } = { resolve };
      waiter.timer = setTimeout(() => {
        this.#waiting = this.#waiting.filter((w) => w !== waiter);
        reject(new PoolTimeoutError(`no free connection after ${this.#acquireTimeoutMs} ms`));
      }, this.#acquireTimeoutMs);
      this.#waiting.push(waiter);
    });
  }

  release(item: T): void {
    const next = this.#waiting.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(item); // hand it straight to the next waiter
    } else {
      this.#idle.push(item);
    }
  }

  async use<R>(fn: (item: T) => Promise<R>): Promise<R> {
    const item = await this.acquire();
    try {
      return await fn(item);
    } finally {
      this.release(item); // always give it back
    }
  }

  /** Every item, for start-up work such as migrations or closing. */
  items(): readonly T[] {
    return this.#all;
  }
}
