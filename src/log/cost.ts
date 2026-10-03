import type { Price } from "../config.ts";
import type { Usage } from "../sse.ts";

/**
 * USD cost of one request. Cached reads and cache writes are subsets of
 * `input`; the remainder is billed at the plain input rate.
 */
export function costUSD(usage: Usage, price: Price): number {
  const fresh = Math.max(0, usage.input - usage.cachedRead - usage.cacheWrite);
  return (
    (fresh * price.input + usage.cachedRead * price.cachedRead + usage.cacheWrite * price.cachedWrite + usage.output * price.output) /
    1e6
  );
}
