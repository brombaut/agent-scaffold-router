import { expect, test } from "bun:test";
import { deepMerge } from "../src/merge.ts";
import { DEFAULT_SETTINGS, withDefaults } from "../src/settings.ts";

test("merges nested objects", () => {
  expect(withDefaults({ theme: { mode: "dark" } })).toEqual({
    theme: { mode: "dark", accent: "blue" },
    editor: { tabSize: 2, rulers: [80, 120] },
  });
});

test("is stable across calls and leaves the defaults alone", () => {
  withDefaults({ theme: { mode: "dark" }, editor: { tabSize: 8 } });
  expect(withDefaults({})).toEqual({
    theme: { mode: "light", accent: "blue" },
    editor: { tabSize: 2, rulers: [80, 120] },
  });
  expect(DEFAULT_SETTINGS.theme.mode).toBe("light");
});

test("arrays from the user replace the defaults", () => {
  expect(withDefaults({ editor: { rulers: [100] } }).editor.rulers).toEqual([100]);
});

test("does not pollute Object.prototype", () => {
  deepMerge({}, JSON.parse('{"__proto__": {"polluted": true}}'));
  deepMerge({}, JSON.parse('{"constructor": {"prototype": {"polluted2": true}}}'));
  expect(({} as any).polluted).toBeUndefined();
  expect(({} as any).polluted2).toBeUndefined();
});

test("deepMerge still returns the merged object", () => {
  expect(deepMerge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
});
