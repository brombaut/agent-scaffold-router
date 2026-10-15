import { expect, test } from "bun:test";
import { mapLimit, Mutex } from "../src/pool.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("results come back in input order", async () => {
  const out = await mapLimit([30, 5, 15, 1], 2, async (ms) => {
    await sleep(ms);
    return ms * 10;
  });
  expect(out).toEqual([300, 50, 150, 10]);
});

test("every item runs exactly once, never more than `limit` at a time", async () => {
  const calls: number[] = [];
  let active = 0;
  let peak = 0;
  const out = await mapLimit([...Array(10).keys()], 3, async (item, index) => {
    expect(index).toBe(item);
    calls.push(item);
    peak = Math.max(peak, ++active);
    await sleep(((item * 7) % 4) * 3);
    active--;
    return item;
  });
  expect(out).toEqual([...Array(10).keys()]);
  expect([...calls].sort((a, b) => a - b)).toEqual([...Array(10).keys()]);
  expect(peak).toBe(3);
});

test("limit larger than the input, and empty input", async () => {
  expect(await mapLimit([1, 2], 10, async (x) => x + 1)).toEqual([2, 3]);
  expect(await mapLimit([], 2, async (x) => x)).toEqual([]);
});

test("a limit below 1 is rejected", async () => {
  await expect(Promise.resolve().then(() => mapLimit([1], 0, async (x) => x))).rejects.toThrow(RangeError);
});

test("the first failure rejects, and nothing new starts after it", async () => {
  const started: number[] = [];
  const boom = new Error("boom");
  const p = mapLimit([...Array(8).keys()], 2, async (item) => {
    started.push(item);
    await sleep(item === 1 ? 5 : 20);
    if (item === 1) throw boom;
    return item;
  });
  await expect(p).rejects.toBe(boom);
  await sleep(80);
  expect(started).toEqual([0, 1]);
});

test("a synchronous throw from fn rejects too", async () => {
  const err = new Error("sync");
  await expect(
    mapLimit([1, 2, 3], 1, (x) => {
      if (x === 2) throw err;
      return Promise.resolve(x);
    }),
  ).rejects.toBe(err);
});

test("aborting rejects with the reason and stops starting work", async () => {
  const ctrl = new AbortController();
  const started: number[] = [];
  const p = mapLimit([...Array(6).keys()], 1, async (item) => {
    started.push(item);
    await sleep(10);
    return item;
  }, { signal: ctrl.signal });
  setTimeout(() => ctrl.abort(new Error("cancelled")), 15);
  await expect(p).rejects.toThrow("cancelled");
  await sleep(50);
  expect(started).toEqual([0, 1]);
});

test("an already-aborted signal rejects without calling fn", async () => {
  const ctrl = new AbortController();
  ctrl.abort(new Error("nope"));
  let calls = 0;
  await expect(mapLimit([1, 2], 2, async (x) => (calls++, x), { signal: ctrl.signal })).rejects.toThrow("nope");
  expect(calls).toBe(0);
});

test("mutex runs callbacks one at a time in arrival order", async () => {
  const m = new Mutex();
  const order: number[] = [];
  let inside = 0;
  const job = (n: number) =>
    m.runExclusive(async () => {
      expect(++inside).toBe(1);
      order.push(n);
      await sleep(5);
      inside--;
      return n;
    });
  const results = await Promise.all([job(1), job(2), job(3), job(4)]);
  expect(results).toEqual([1, 2, 3, 4]);
  expect(order).toEqual([1, 2, 3, 4]);
});

test("mutex is released when the callback throws", async () => {
  const m = new Mutex();
  await expect(m.runExclusive(async () => { throw new Error("x"); })).rejects.toThrow("x");
  const r = await Promise.race([m.runExclusive(() => 42), sleep(200).then(() => "deadlock")]);
  expect(r).toBe(42);
});

test("a caller arriving during a handoff does not jump the queue", async () => {
  const m = new Mutex();
  const order: string[] = [];
  const first = m.runExclusive(async () => {
    await sleep(5);
    order.push("first");
  });
  const waiting = m.runExclusive(() => order.push("waiting"));
  await first;
  await m.runExclusive(() => order.push("late"));
  await waiting;
  expect(order).toEqual(["first", "waiting", "late"]);
});
