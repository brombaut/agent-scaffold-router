import { createHash } from "node:crypto";
import type { Task } from "./types.ts";

export function hash(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

/** Cache key for a task: its own input plus the keys of its dependencies, so any change below it changes the key. */
export function taskKey(task: Task, depKeys: string[]): string {
  return hash(task.id, task.input, ...depKeys);
}
