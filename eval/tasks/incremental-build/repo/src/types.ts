export interface Task {
  id: string;
  deps: string[];
  /** The task's own source content; editing it must trigger a rebuild. */
  input: string;
  /** Receives dependency outputs in the order of `deps`. */
  run: (depOutputs: string[], input: string) => string;
}

export type Graph = Map<string, Task>;
