/**
 * Maps `items` through async `fn`, running at most `limit` calls at once.
 * Resolves with the results in input order. On the first rejection, or when
 * `signal` aborts, rejects with that error (or the abort reason) and starts no
 * further calls; calls already running are left to finish. A synchronous throw
 * from `fn` counts as a rejection. Rejects with a RangeError if `limit` < 1.
 */
export function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  opts: { signal?: AbortSignal } = {},
): Promise<R[]> {
  return new Promise((resolve, reject) => {
    if (!(limit >= 1)) return reject(new RangeError(`limit must be >= 1, got ${limit}`));
    const { signal } = opts;
    const results = new Array<R>(items.length);
    let next = 0;
    let finished = 0;
    let stopped = false;
    const onAbort = () => fail(signal!.reason);
    const fail = (err: unknown) => {
      if (stopped) return;
      stopped = true;
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    };
    const launch = () => {
      while (!stopped && next < items.length && next - finished < limit) {
        const i = next++;
        new Promise<R>((res) => res(fn(items[i], i))).then((r) => {
          results[i] = r;
          finished++;
          if (finished === items.length) {
            signal?.removeEventListener("abort", onAbort);
            stopped = true;
            resolve(results);
          } else launch();
        }, fail);
      }
    };
    if (signal?.aborted) return fail(signal.reason);
    signal?.addEventListener("abort", onAbort);
    if (items.length === 0) return resolve(results);
    launch();
  });
}

/** Runs callbacks one at a time, in the order they were queued. */
export class Mutex {
  private locked = false;
  private waiters: (() => void)[] = [];

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    if (this.locked) await new Promise<void>((r) => this.waiters.push(r));
    else this.locked = true;
    try {
      return await fn();
    } finally {
      // Hand the lock straight to the next waiter so nobody can barge in.
      const next = this.waiters.shift();
      if (next) next();
      else this.locked = false;
    }
  }
}
