#!/usr/bin/env bun
/**
 * Free replay (spec 003): prices a turn-start decision rule against a finished
 * run, without new agent runs. For each task, the rule picks weak or strong,
 * and the replay takes that config's real outcome and cost from the run.
 * Assumes auto started on a tier behaves like that tier's plain run.
 *
 *   bun eval/replay.ts <run dir> [decisions.json]
 *
 * decisions.json maps task id → "weak" | "strong" (e.g. a classifier's answers).
 */
import { join } from "node:path";
import type { RunResult } from "./run.ts";

type Tier = "weak" | "strong";

export interface Replay {
  rule: string;
  solved: number;
  tasks: number;
  strongPicks: number;
  costUSD: number;
}

/** Replays `pick` over the tasks that have both a weak and a strong result (rep 1). */
export function replay(results: RunResult[], rule: string, pick: (task: string) => Tier): Replay {
  const byTask = new Map<string, Partial<Record<string, RunResult>>>();
  for (const r of results.filter((r) => r.rep === 1)) byTask.set(r.task, { ...byTask.get(r.task), [r.config]: r });
  const out: Replay = { rule, solved: 0, tasks: 0, strongPicks: 0, costUSD: 0 };
  for (const [task, c] of byTask) {
    if (!c.weak || !c.strong) continue;
    const tier = pick(task);
    const r = c[tier]!;
    out.tasks++;
    out.solved += r.solved ? 1 : 0;
    out.strongPicks += tier === "strong" ? 1 : 0;
    out.costUSD += r.costUSD;
  }
  return out;
}

export function baselines(results: RunResult[]): Replay[] {
  const get = (task: string, config: string) => results.find((r) => r.task === task && r.config === config && r.rep === 1);
  return [
    replay(results, "always weak", () => "weak"),
    replay(results, "always strong", () => "strong"),
    // What auto's turn-start heuristic actually picked in this run.
    replay(results, "current heuristic", (t) => (get(t, "auto")?.startTier === "strong" ? "strong" : "weak")),
    // Strong only where weak fails and strong solves.
    replay(results, "perfect", (t) => (!get(t, "weak")?.solved && get(t, "strong")?.solved ? "strong" : "weak")),
  ];
}

function format(rows: Replay[]): string {
  const lines = rows.map(
    (r) => `| ${r.rule} | ${r.solved}/${r.tasks} | ${r.strongPicks} | $${r.costUSD.toFixed(2)} | ${r.solved ? `$${(r.costUSD / r.solved).toFixed(4)}` : "-"} |`,
  );
  return ["| rule | solved | strong picks | cost | $/solved |", "|---|---|---|---|---|", ...lines].join("\n");
}

if (import.meta.main) {
  const [dir, decisionsPath] = process.argv.slice(2);
  if (!dir) {
    console.error("usage: bun eval/replay.ts <run dir> [decisions.json]");
    process.exit(1);
  }
  const text = await Bun.file(join(dir, "results.jsonl")).text();
  const results = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as RunResult);
  const rows = baselines(results);
  if (decisionsPath) {
    const decisions: Record<string, Tier> = await Bun.file(decisionsPath).json();
    rows.push(replay(results, decisionsPath.split("/").pop()!, (t) => decisions[t] ?? "strong"));
  }
  console.log(format(rows));
}
