import { expect, test } from "bun:test";
import { apply, applyAll, transform, type Op } from "../src/ot.ts";

function converge(doc: string, a: Op, b: Op): [string, string] {
  return [applyAll(apply(doc, a), transform(b, a)), applyAll(apply(doc, b), transform(a, b))];
}

test("inserts at different positions", () => {
  const [x, y] = converge("abcd", { type: "ins", pos: 1, text: "X", site: 1 }, { type: "ins", pos: 3, text: "Y", site: 2 });
  expect(x).toBe("aXbcYd");
  expect(y).toBe("aXbcYd");
});

test("concurrent inserts at the same position are ordered by site", () => {
  const [x, y] = converge("ab", { type: "ins", pos: 1, text: "2", site: 2 }, { type: "ins", pos: 1, text: "1", site: 1 });
  expect(x).toBe("a12b");
  expect(y).toBe("a12b");
});

test("text inserted inside a concurrently deleted range survives", () => {
  const [x, y] = converge("hello world", { type: "del", pos: 2, len: 6 }, { type: "ins", pos: 5, text: "!!", site: 2 });
  expect(x).toBe("he!!rld");
  expect(y).toBe("he!!rld");
});

test("overlapping deletes", () => {
  const [x, y] = converge("abcdefgh", { type: "del", pos: 1, len: 4 }, { type: "del", pos: 3, len: 4 });
  expect(x).toBe("ah");
  expect(y).toBe("ah");
});

test("delete contained in another delete", () => {
  const [x, y] = converge("abcdefgh", { type: "del", pos: 3, len: 2 }, { type: "del", pos: 1, len: 6 });
  expect(x).toBe("ah");
  expect(y).toBe("ah");
});

// Small seeded PRNG so failures are reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("random concurrent edits always converge", () => {
  const r = rng(42);
  const int = (n: number) => Math.floor(r() * n);
  const word = () => Array.from({ length: 1 + int(3) }, () => "xyz"[int(3)]).join("");
  const randomOp = (doc: string, site: number): Op => {
    if (doc.length === 0 || r() < 0.5) return { type: "ins", pos: int(doc.length + 1), text: word(), site };
    const pos = int(doc.length);
    return { type: "del", pos, len: 1 + int(doc.length - pos) };
  };
  for (let i = 0; i < 3000; i++) {
    const doc = Array.from({ length: int(12) }, () => "abcdefgh"[int(8)]).join("");
    const a = randomOp(doc, 1);
    const b = randomOp(doc, 2);
    const [x, y] = converge(doc, a, b);
    if (x !== y) throw new Error(`diverged on ${JSON.stringify({ doc, a, b })}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
  }
});
