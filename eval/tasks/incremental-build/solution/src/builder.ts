import { taskKey } from "./cache.ts";
import { buildOrder } from "./graph.ts";
import type { Graph } from "./types.ts";

export interface BuildResult {
  output: string;
  /** Ids of the tasks that actually ran (cache misses), in run order. */
  ran: string[];
}

export class Builder {
  private cache = new Map<string, string>();

  constructor(private graph: Graph) {}

  build(target: string): BuildResult {
    const ran: string[] = [];
    const keys = new Map<string, string>();
    const outputs = new Map<string, string>();
    for (const id of buildOrder(this.graph, target)) {
      const task = this.graph.get(id)!;
      const key = taskKey(task, task.deps.map((d) => keys.get(d)!));
      keys.set(id, key);
      let out = this.cache.get(key);
      if (out === undefined) {
        out = task.run(task.deps.map((d) => outputs.get(d)!), task.input);
        this.cache.set(key, out);
        ran.push(id);
      }
      outputs.set(id, out);
    }
    return { output: outputs.get(target)!, ran };
  }
}
