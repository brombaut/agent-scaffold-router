import { createHash } from "node:crypto";
import type { Graph, Task } from "./types.ts";

export function hash(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

/** Cache key for a task: its own input plus what it depends on. */
export function taskKey(task: Task, graph: Graph): string {
  return hash(task.id, task.input, ...task.deps.map((d) => graph.get(d)!.input));
}
