import { expect, test } from "bun:test";
import { LRUCache } from "../src/lru.ts";

test("evicts the least recently set entry", () => {
  const c = new LRUCache<string, number>(2);
  c.set("a", 1);
  c.set("b", 2);
  c.set("c", 3);
  expect(c.has("a")).toBe(false);
  expect(c.size).toBe(2);
});

test("a read refreshes recency", () => {
  const c = new LRUCache<string, number>(2);
  c.set("a", 1);
  c.set("b", 2);
  expect(c.get("a")).toBe(1);
  c.set("c", 3);
  expect(c.has("a")).toBe(true);
  expect(c.has("b")).toBe(false);
});

test("overwriting refreshes recency", () => {
  const c = new LRUCache<string, number>(2);
  c.set("a", 1);
  c.set("b", 2);
  c.set("a", 10);
  c.set("c", 3);
  expect(c.get("a")).toBe(10);
  expect(c.has("b")).toBe(false);
});

test("has() does not count as a use", () => {
  const c = new LRUCache<string, number>(2);
  c.set("a", 1);
  c.set("b", 2);
  c.has("a");
  c.set("c", 3);
  expect(c.has("a")).toBe(false);
});

test("missing keys", () => {
  const c = new LRUCache<string, number>(1);
  expect(c.get("nope")).toBeUndefined();
});
