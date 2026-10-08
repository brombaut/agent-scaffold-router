import { expect, test } from "bun:test";
import { clamp, lerp } from "../src/math.ts";

test("clamp inside, below, above", () => {
  expect(clamp(5, 0, 10)).toBe(5);
  expect(clamp(-3, 0, 10)).toBe(0);
  expect(clamp(42, 0, 10)).toBe(10);
});

test("clamp swaps reversed bounds", () => {
  expect(clamp(42, 10, 0)).toBe(10);
  expect(clamp(-1, 10, 0)).toBe(0);
});

test("clamp passes NaN through", () => {
  expect(clamp(NaN, 0, 1)).toBeNaN();
});

test("lerp", () => {
  expect(lerp(0, 10, 0.5)).toBe(5);
});
