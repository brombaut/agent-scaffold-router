import { expect, test } from "bun:test";
import { range } from "../src/range.ts";

test("end is exclusive", () => {
  expect(range(0, 3)).toEqual([0, 1, 2]);
  expect(range(2, 2)).toEqual([]);
});

test("step", () => {
  expect(range(0, 10, 3)).toEqual([0, 3, 6, 9]);
});

test("negative step", () => {
  expect(range(3, 0, -1)).toEqual([3, 2, 1]);
});

test("zero step throws", () => {
  expect(() => range(0, 1, 0)).toThrow();
});
