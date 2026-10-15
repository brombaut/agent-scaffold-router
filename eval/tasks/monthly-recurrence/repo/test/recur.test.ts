import { expect, test } from "bun:test";
import { occurrences } from "../src/recur.ts";

const FRI = 5, TUE = 2, THU = 4;

test("the 31st skips months without one", () => {
  expect(occurrences({ byMonthDay: [31], count: 4 }, "2026-01-01")).toEqual(["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31"]);
});

test("starting on the 31st with no explicit day keeps the 31st", () => {
  expect(occurrences({ count: 4 }, "2026-01-31")).toEqual(["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31"]);
});

test("-1 is the last day of each month, including leap years", () => {
  expect(occurrences({ byMonthDay: [-1], count: 3 }, "2026-01-01")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  expect(occurrences({ byMonthDay: [-1], count: 1 }, "2028-02-01")).toEqual(["2028-02-29"]);
  expect(occurrences({ byMonthDay: [-2], count: 2 }, "2026-04-01")).toEqual(["2026-04-29", "2026-05-30"]);
});

test("last Friday of the month", () => {
  expect(occurrences({ byDay: [{ weekday: FRI, nth: -1 }], count: 3 }, "2026-10-01")).toEqual(["2026-10-30", "2026-11-27", "2026-12-25"]);
});

test("fifth Thursday only in months that have one", () => {
  expect(occurrences({ byDay: [{ weekday: THU, nth: 5 }], count: 3 }, "2026-01-01")).toEqual(["2026-01-29", "2026-04-30", "2026-07-30"]);
});

test("every third month on the second Tuesday", () => {
  expect(occurrences({ interval: 3, byDay: [{ weekday: TUE, nth: 2 }], count: 3 }, "2026-01-01")).toEqual(["2026-01-13", "2026-04-14", "2026-07-14"]);
});

test("several days in a month come out sorted", () => {
  expect(occurrences({ byMonthDay: [15, 1], count: 4 }, "2026-01-01")).toEqual(["2026-01-01", "2026-01-15", "2026-02-01", "2026-02-15"]);
});

test("until is inclusive", () => {
  expect(occurrences({ byMonthDay: [10] }, "2026-01-01")).toHaveLength(1000);
  expect(occurrences({ byMonthDay: [10], until: "2026-03-10" }, "2026-01-01")).toEqual(["2026-01-10", "2026-02-10", "2026-03-10"]);
});

test("count only counts dates on or after start", () => {
  expect(occurrences({ byMonthDay: [1, 20], count: 3 }, "2026-01-10")).toEqual(["2026-01-20", "2026-02-01", "2026-02-20"]);
});

test("a rule that never matches returns nothing instead of hanging", () => {
  expect(occurrences({ byMonthDay: [30], count: 2 }, "2026-02-01", 2).length).toBe(2);
  expect(occurrences({ byDay: [{ weekday: FRI, nth: 5 }], until: "2026-04-30" }, "2026-02-01")).toEqual([]);
});
