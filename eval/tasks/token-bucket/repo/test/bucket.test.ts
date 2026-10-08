import { expect, test } from "bun:test";
import { TokenBucket } from "../src/bucket.ts";

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("starts full and drains", () => {
  const c = clock();
  const b = new TokenBucket(3, 1, c.now);
  expect([b.tryRemove(), b.tryRemove(), b.tryRemove(), b.tryRemove()]).toEqual([true, true, true, false]);
});

test("frequent polling still refills", () => {
  const c = clock();
  const b = new TokenBucket(2, 2, c.now);
  b.tryRemove();
  b.tryRemove();
  let granted = 0;
  for (let i = 0; i < 10; i++) {
    c.advance(100);
    if (b.tryRemove()) granted++;
  }
  expect(granted).toBe(2);
});

test("never holds more than capacity after idling", () => {
  const c = clock();
  const b = new TokenBucket(2, 5, c.now);
  c.advance(60_000);
  expect([b.tryRemove(), b.tryRemove(), b.tryRemove()]).toEqual([true, true, false]);
});

test("removing several tokens at once", () => {
  const c = clock();
  const b = new TokenBucket(5, 1, c.now);
  expect(b.tryRemove(4)).toBe(true);
  expect(b.tryRemove(2)).toBe(false);
  c.advance(1000);
  expect(b.tryRemove(2)).toBe(true);
});
