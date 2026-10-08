/**
 * Token bucket rate limiter: holds at most `capacity` tokens and refills
 * continuously at `refillPerSec`. Starts full.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private capacity: number,
    private refillPerSec: number,
    private now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  tryRemove(n = 1): boolean {
    const t = this.now();
    const added = Math.floor(((t - this.last) / 1000) * this.refillPerSec);
    this.tokens += added;
    this.last = t;
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }
}
