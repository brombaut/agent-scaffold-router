import { expect, test } from "bun:test";
import { Emitter } from "../src/emitter.ts";

test("on/emit", () => {
  const e = new Emitter();
  const seen: number[] = [];
  e.on("x", (n) => seen.push(n));
  expect(e.emit("x", 1)).toBe(true);
  expect(e.emit("y")).toBe(false);
  expect(seen).toEqual([1]);
});

test("once fires exactly once and does not skip the next handler", () => {
  const e = new Emitter();
  const seen: string[] = [];
  e.once("x", () => seen.push("once"));
  e.on("x", () => seen.push("a"));
  e.on("x", () => seen.push("b"));
  e.emit("x");
  e.emit("x");
  expect(seen).toEqual(["once", "a", "b", "a", "b"]);
});

test("off removes a handler added with once", () => {
  const e = new Emitter();
  let called = false;
  const fn = () => (called = true);
  e.once("x", fn);
  e.off("x", fn);
  e.emit("x");
  expect(called).toBe(false);
  expect(e.listenerCount("x")).toBe(0);
});

test("a handler added during emit runs on the next emit, not this one", () => {
  const e = new Emitter();
  const seen: string[] = [];
  e.on("x", () => {
    seen.push("first");
    e.on("x", () => seen.push("late"));
  });
  e.emit("x");
  expect(seen).toEqual(["first"]);
});
