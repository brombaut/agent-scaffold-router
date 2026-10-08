import { expect, test } from "bun:test";
import { fetchAll } from "../src/fetch.ts";

const delayed = (ms: Record<string, number>) => (id: string) =>
  new Promise<string>((r) => setTimeout(() => r(id.toUpperCase()), ms[id] ?? 1));

test("returns every result in id order", async () => {
  const out = await fetchAll(["a", "b", "c", "d", "e"], delayed({ a: 30, b: 5, c: 20, d: 1, e: 10 }), 2);
  expect(out).toEqual(["A", "B", "C", "D", "E"]);
});

test("empty input", async () => {
  expect(await fetchAll([], delayed({}))).toEqual([]);
});

test("never more than `concurrency` in flight, and actually parallel", async () => {
  let inFlight = 0;
  let peak = 0;
  const fetcher = async (id: string) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
    return id;
  };
  await fetchAll(["1", "2", "3", "4", "5", "6", "7"], fetcher, 3);
  expect(peak).toBe(3);
});

test("rejects when a fetch fails", async () => {
  const fetcher = async (id: string) => {
    if (id === "bad") throw new Error("boom");
    return id;
  };
  await expect(fetchAll(["ok", "bad", "ok2"], fetcher)).rejects.toThrow("boom");
});
