#!/usr/bin/env bun
/**
 * Spec 003, step 2: runs the turn-start classifier on each task's prompt and
 * writes the picks for eval/replay.ts. Spends real money (one small call per
 * task), and stops once spend reaches --budget.
 *
 *   bun eval/classify.ts --model weak|strong --budget USD [--suite polyglot] [--out file.json]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveApiKey } from "../src/auth.ts";
import type { TierName } from "../src/config.ts";
import { CONFIG_PATH, loadConfig } from "../src/config.ts";
import { classify } from "../src/router/classifier.ts";
import { loadTasks, type Suite } from "./run.ts";

const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const model = flag("--model") as TierName;
const budget = Number(flag("--budget"));
const suite = (flag("--suite") ?? "polyglot") as Suite;
if ((model !== "weak" && model !== "strong") || !(budget > 0)) {
  console.error("usage: bun eval/classify.ts --model weak|strong --budget USD [--suite polyglot] [--out file.json]");
  process.exit(1);
}
const out = resolve(flag("--out") ?? join(import.meta.dir, "runs/classify", `${suite}-${model}.json`));

const cfg = await loadConfig(CONFIG_PATH);
const apiKey = await resolveApiKey(cfg);
if (!apiKey) throw new Error(`no upstream API key (set ${cfg.upstream.apiKeyEnv} or connect Zen in OpenCode)`);

const picks: Record<string, TierName> = {};
const details: Record<string, { tier: TierName; raw: string; costUSD: number }> = {};
let spent = 0;
for (const task of await loadTasks(suite)) {
  if (spent >= budget) {
    console.log(`budget reached ($${spent.toFixed(4)}); stopping`);
    break;
  }
  const c = await classify(task.prompt, model, cfg, apiKey);
  spent += c.costUSD;
  picks[task.id] = c.tier;
  details[task.id] = { tier: c.tier, raw: c.raw, costUSD: c.costUSD };
  console.log(`${c.tier.padEnd(6)} ${task.id.padEnd(36)} $${c.costUSD.toFixed(5)}  ${c.raw.slice(0, 60).replace(/\s+/g, " ")}`);
}
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(picks, null, 2));
await writeFile(out.replace(/\.json$/, ".details.json"), JSON.stringify({ model: cfg.tiers[model].model, spent, details }, null, 2));
console.log(`\n${Object.values(picks).filter((t) => t === "strong").length}/${Object.keys(picks).length} strong, spent $${spent.toFixed(4)} → ${out}`);
