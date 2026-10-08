import { expect, test } from "bun:test";
import { farewell, greet } from "../src/greet.ts";

test("greet", () => {
  expect(greet("Ada")).toBe("Hello, Ada!");
});

test("farewell", () => {
  expect(farewell("Ada")).toBe("Goodbye, Ada.");
});
