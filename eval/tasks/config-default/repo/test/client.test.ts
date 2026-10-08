import { expect, test } from "bun:test";
import { clientOptions } from "../src/client.ts";

test("defaults", () => {
  expect(clientOptions({ baseURL: "http://x" })).toEqual({ baseURL: "http://x", timeoutMs: 5000, retries: 3 });
});

test("overrides win", () => {
  expect(clientOptions({ baseURL: "http://x", timeoutMs: 10 }).timeoutMs).toBe(10);
});
