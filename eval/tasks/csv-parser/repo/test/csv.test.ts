import { expect, test } from "bun:test";
import { parseCSV } from "../src/csv.ts";

test("simple rows", () => {
  expect(parseCSV("a,b,c\n1,2,3\n")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
});

test("quoted field with a comma", () => {
  expect(parseCSV('name,city\n"Smith, J",Paris')).toEqual([["name", "city"], ["Smith, J", "Paris"]]);
});

test("doubled quotes", () => {
  expect(parseCSV('"say ""hi""",x')).toEqual([['say "hi"', "x"]]);
});

test("newline inside quotes", () => {
  expect(parseCSV('"line1\nline2",b\nc,d')).toEqual([["line1\nline2", "b"], ["c", "d"]]);
});

test("CRLF line endings", () => {
  expect(parseCSV("a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]]);
});

test("empty fields", () => {
  expect(parseCSV(',x,\n"",y,""')).toEqual([["", "x", ""], ["", "y", ""]]);
});

test("empty input", () => {
  expect(parseCSV("")).toEqual([]);
});
