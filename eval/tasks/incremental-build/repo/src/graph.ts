import type { Graph } from "./types.ts";

export class CycleError extends Error {}

/** Returns `target` and everything it depends on, dependencies first, each once. */
export function buildOrder(graph: Graph, target: string): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (seen.has(id)) throw new CycleError(`cycle detected: ${[...path, id].join(" -> ")}`);
    const task = graph.get(id);
    if (!task) throw new Error(`unknown task: ${id}`);
    seen.add(id);
    for (const dep of task.deps) visit(dep, [...path, id]);
    order.push(id);
  };
  visit(target, []);
  return order;
}
