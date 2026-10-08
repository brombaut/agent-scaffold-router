import { expect, test } from "bun:test";
import { slugify } from "../src/slug.ts";

test("lowercases and joins words with dashes", () => {
  expect(slugify("Hello World")).toBe("hello-world");
});

test("collapses punctuation and whitespace", () => {
  expect(slugify("  Bun, TypeScript & You!  ")).toBe("bun-typescript-you");
});

test("strips accents", () => {
  expect(slugify("Crème Brûlée")).toBe("creme-brulee");
});

test("keeps digits", () => {
  expect(slugify("Top 10 Tips")).toBe("top-10-tips");
});

test("empty when nothing is left", () => {
  expect(slugify("!!!")).toBe("");
});
