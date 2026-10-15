import { expect, test } from "bun:test";
import { applyPatch, PatchError, parsePointer } from "../src/patch.ts";

test("pointer escapes are decoded in the right order", () => {
  expect(parsePointer("/a~1b/m~0n/~01")).toEqual(["a/b", "m~n", "~1"]);
  expect(applyPatch({ "a/b": 1, "~1": 2 }, [{ op: "replace", path: "/~01", value: 3 }])).toEqual({ "a/b": 1, "~1": 3 });
});

test("add inserts into arrays and '-' appends", () => {
  const doc = { xs: [1, 2, 3] };
  expect(applyPatch(doc, [{ op: "add", path: "/xs/1", value: 9 }])).toEqual({ xs: [1, 9, 2, 3] });
  expect(applyPatch(doc, [{ op: "add", path: "/xs/-", value: 4 }])).toEqual({ xs: [1, 2, 3, 4] });
  expect(applyPatch(doc, [{ op: "add", path: "/xs/3", value: 4 }])).toEqual({ xs: [1, 2, 3, 4] });
});

test("bad array indexes are rejected", () => {
  const doc = { xs: [1, 2, 3] };
  expect(() => applyPatch(doc, [{ op: "add", path: "/xs/5", value: 0 }])).toThrow(PatchError);
  expect(() => applyPatch(doc, [{ op: "add", path: "/xs/01", value: 0 }])).toThrow(PatchError);
  expect(() => applyPatch(doc, [{ op: "replace", path: "/xs/3", value: 0 }])).toThrow(PatchError);
  expect(() => applyPatch(doc, [{ op: "remove", path: "/xs/-" }])).toThrow(PatchError);
});

test("remove from an array shifts later elements", () => {
  expect(applyPatch({ xs: ["a", "b", "c"] }, [{ op: "remove", path: "/xs/0" }])).toEqual({ xs: ["b", "c"] });
});

test("replace inside an array replaces, it does not insert", () => {
  expect(applyPatch({ xs: [1, 2, 3] }, [{ op: "replace", path: "/xs/1", value: 7 }])).toEqual({ xs: [1, 7, 3] });
});

test("inherited properties are not part of the document", () => {
  expect(() => applyPatch({}, [{ op: "remove", path: "/toString" }])).toThrow(PatchError);
  expect(() => applyPatch({ a: {} }, [{ op: "test", path: "/a/constructor", value: 1 }])).toThrow(PatchError);
});

test("move between arrays and refusal to move into a child", () => {
  expect(applyPatch({ a: [1, 2], b: [3] }, [{ op: "move", from: "/a/0", path: "/b/-" }])).toEqual({ a: [2], b: [3, 1] });
  expect(() => applyPatch({ a: { b: {} } }, [{ op: "move", from: "/a", path: "/a/b/c" }])).toThrow(PatchError);
});

test("copy makes an independent copy", () => {
  const out = applyPatch({ a: { n: 1 } }, [
    { op: "copy", from: "/a", path: "/b" },
    { op: "replace", path: "/b/n", value: 2 },
  ]);
  expect(out).toEqual({ a: { n: 1 }, b: { n: 2 } });
});

test("values added by the patch are not shared with the patch", () => {
  const value = { tags: ["x"] };
  const out = applyPatch({}, [{ op: "add", path: "/v", value }]) as any;
  out.v.tags.push("y");
  expect(value).toEqual({ tags: ["x"] });
});

test("test compares by value", () => {
  const doc = { a: { b: [1, { c: null }] } };
  expect(applyPatch(doc, [{ op: "test", path: "/a", value: { b: [1, { c: null }] } }])).toEqual(doc);
  expect(() => applyPatch(doc, [{ op: "test", path: "/a/b", value: [1, { c: 0 }] }])).toThrow(PatchError);
  expect(() => applyPatch({ a: [1] }, [{ op: "test", path: "/a", value: { 0: 1 } }])).toThrow(PatchError);
});

test("the input document is never modified, even when a later op fails", () => {
  const doc = { a: 1, xs: [1, 2] };
  expect(() =>
    applyPatch(doc, [
      { op: "replace", path: "/a", value: 2 },
      { op: "remove", path: "/xs/0" },
      { op: "test", path: "/a", value: 999 },
    ]),
  ).toThrow(PatchError);
  expect(doc).toEqual({ a: 1, xs: [1, 2] });
  applyPatch(doc, [{ op: "add", path: "/b", value: 1 }]);
  expect(doc).toEqual({ a: 1, xs: [1, 2] });
});

test("replacing the root", () => {
  expect(applyPatch({ a: 1 }, [{ op: "replace", path: "", value: [1] }])).toEqual([1]);
});
