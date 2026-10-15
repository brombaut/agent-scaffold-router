import type { Graph } from "./types.ts";

export class CycleError extends Error {}

/** Returns `target` and everything it depends on, dependencies first, each once. */
export function buildOrder(graph: Graph, target: string): string[] {
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]) => {
    const s = state.get(id);
    if (s === "done") return;
    if (s === "visiting") throw new CycleError(`cycle detected: ${[...path, id].join(" -> ")}`);
    const task = graph.get(id);
    if (!task) throw new Error(`unknown task: ${id}`);
    state.set(id, "visiting");
    for (const dep of task.deps) visit(dep, [...path, id]);
    state.set(id, "done");
    order.push(id);
  };
  visit(target, []);
  return order;
}
