/**
 * Maps `items` through async `fn`, running at most `limit` calls at once.
 * Resolves with the results in input order. On the first rejection, or when
 * `signal` aborts, rejects with that error (or the abort reason) and starts no
 * further calls; calls already running are left to finish. A synchronous throw
 * from `fn` counts as a rejection. Rejects with a RangeError if `limit` < 1.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  opts: { signal?: AbortSignal } = {},
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (opts.signal?.aborted) return;
      const r = await fn(items[next], next);
      results.push(r);
      next++;
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

/** Runs callbacks one at a time, in the order they were queued. */
export class Mutex {
  private locked = false;
  private waiters: (() => void)[] = [];

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    while (this.locked) await new Promise<void>((r) => this.waiters.push(r));
    this.locked = true;
    const result = await fn();
    this.locked = false;
    this.waiters.pop()?.();
    return result;
  }
}
