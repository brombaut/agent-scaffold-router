import { expect, test } from "bun:test";
import { Builder } from "../src/builder.ts";
import { CycleError } from "../src/graph.ts";
import type { Graph, Task } from "../src/types.ts";

// Each task's output is "<id>(<input>; <dep outputs>)".
function graph(spec: Record<string, { deps?: string[]; input?: string }>): Graph {
  const g: Graph = new Map();
  for (const [id, s] of Object.entries(spec)) {
    const task: Task = {
      id,
      deps: s.deps ?? [],
      input: s.input ?? id,
      run: (outs, input) => `${id}(${[input, ...outs].join("; ")})`,
    };
    g.set(id, task);
  }
  return g;
}

test("builds a chain, dependencies first", () => {
  const b = new Builder(graph({ app: { deps: ["lib"] }, lib: { deps: ["util"] }, util: {} }));
  const r = b.build("app");
  expect(r.output).toBe("app(app; lib(lib; util(util)))");
  expect(r.ran).toEqual(["util", "lib", "app"]);
});

test("a shared dependency is not a cycle, and runs once", () => {
  const g = graph({ app: { deps: ["ui", "api"] }, ui: { deps: ["core"] }, api: { deps: ["core"] }, core: {} });
  const r = new Builder(g).build("app");
  expect(r.output).toBe("app(app; ui(ui; core(core)); api(api; core(core)))");
  expect(r.ran.filter((id) => id === "core")).toHaveLength(1);
  expect(r.ran).toHaveLength(4);
});

test("real cycles are still reported", () => {
  const g = graph({ a: { deps: ["b"] }, b: { deps: ["c"] }, c: { deps: ["a"] } });
  expect(() => new Builder(g).build("a")).toThrow(CycleError);
  const self = graph({ x: { deps: ["x"] } });
  expect(() => new Builder(self).build("x")).toThrow(CycleError);
});

test("a second build with no changes runs nothing", () => {
  const b = new Builder(graph({ app: { deps: ["lib"] }, lib: {} }));
  b.build("app");
  const r = b.build("app");
  expect(r.ran).toEqual([]);
  expect(r.output).toBe("app(app; lib(lib))");
});

test("editing a deep dependency rebuilds everything above it", () => {
  const g = graph({ app: { deps: ["lib", "assets"] }, lib: { deps: ["util"] }, util: { input: "v1" }, assets: {} });
  const b = new Builder(g);
  b.build("app");
  g.get("util")!.input = "v2";
  const r = b.build("app");
  expect(r.output).toBe("app(app; lib(lib; util(v2)); assets(assets))");
  expect(r.ran).toEqual(["util", "lib", "app"]);
});

test("reverting an edit is served from cache", () => {
  const g = graph({ app: { deps: ["lib"] }, lib: { deps: ["util"] }, util: { input: "v1" } });
  const b = new Builder(g);
  b.build("app");
  g.get("util")!.input = "v2";
  b.build("app");
  g.get("util")!.input = "v1";
  const r = b.build("app");
  expect(r.ran).toEqual([]);
  expect(r.output).toBe("app(app; lib(lib; util(v1)))");
});

test("editing four levels down in a diamond", () => {
  const g = graph({
    top: { deps: ["l", "r"] },
    l: { deps: ["m"] },
    r: { deps: ["m"] },
    m: { deps: ["leaf"] },
    leaf: { input: "1" },
  });
  const b = new Builder(g);
  b.build("top");
  g.get("leaf")!.input = "2";
  const r = b.build("top");
  expect(r.output).toBe("top(top; l(l; m(m; leaf(2))); r(r; m(m; leaf(2))))");
  expect(new Set(r.ran)).toEqual(new Set(["leaf", "m", "l", "r", "top"]));
});
