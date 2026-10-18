#!/usr/bin/env bun
/**
 * Evaluation harness (child #5): runs each task with OpenCode through the
 * router as router/auto, router/strong and router/weak, then compares tasks
 * solved, cost and wall time. See eval/README.md.
 */
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveApiKey } from "../src/auth.ts";
import { CONFIG_PATH, loadConfig } from "../src/config.ts";
import type { DecisionLogLine } from "../src/log/decisions.ts";
import { aggregate } from "../src/report.ts";
import { startServer } from "../src/server.ts";
import { startMockUpstream } from "./mock.ts";

const ROOT = resolve(import.meta.dir, "..");
const TASKS_DIR = join(ROOT, "eval/tasks");
const RUNS_DIR = join(ROOT, "eval/runs");
const POLYGLOT_DIR = join(ROOT, "eval/polyglot");
const POLYGLOT_SUBSET = join(ROOT, "eval/polyglot-subset.txt");
const POLYGLOT_IMAGE = "asr-polyglot";
const CONFIGS = ["auto", "strong", "weak"] as const;
type RouterConfig = (typeof CONFIGS)[number];

const USAGE = `bun eval/run.ts <command>

Commands (all take --suite tasks|polyglot; default tasks, our own TypeScript tasks):
  list                            List the tasks.
  self-check [--tasks a,b]        Free: checks each task fails as given and passes with its reference solution.
  run (--mock | --live --budget USD) [--tasks a,b] [--configs auto,strong,weak]
      [--reps N] [--timeout SECONDS] [--capture] [--hide-tests] [--followup]
                                  --mock: fake upstream, costs nothing, every task fails (pipeline smoke test).
                                  --live: real Zen calls. Stops, and refuses further upstream calls,
                                  once logged spend reaches --budget.
                                  --hide-tests: the agent's workspace has no test/ dir (it is put
                                  back for the check), and tasks use hiddenPrompt if they have one.
                                  --followup: when turn 1 fails, send the test output as a second
                                  user message in the same session (Aider's second try).
  summarize <run dir>             Rebuild summary.md from a run's results.jsonl.
`;

// ---------------------------------------------------------------------------
// Tasks

export interface Task {
  id: string;
  difficulty: "easy" | "hard";
  language: string;
  prompt: string;
  /** Prompt for --hide-tests runs, when `prompt` refers to the tests. */
  hiddenPrompt?: string;
  /** Check command, run in the workspace after the agent finishes. */
  check: string[];
  /** Directory copied into the workspace. */
  repo: string;
  /** Paths the agent must not change; restored from `repo` before the check. */
  protect: string[];
  /** Paths always left out of the workspace (e.g. the reference solution). */
  hide: string[];
  /** Files the agent is asked to edit, named in the follow-up message. */
  editFiles: string[];
  /** Reference solution for self-check: copied from [0] to workspace path [1]. */
  solution: [string, string];
}

export const SUITES = ["tasks", "polyglot"] as const;
export type Suite = (typeof SUITES)[number];

export async function loadTasks(suite: Suite, only?: string[]): Promise<Task[]> {
  const ids =
    suite === "tasks"
      ? (await readdir(TASKS_DIR)).sort()
      : (await Bun.file(POLYGLOT_SUBSET).text()).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const missing = only?.filter((id) => !ids.includes(id)) ?? [];
  if (missing.length) throw new Error(`unknown task(s): ${missing.join(", ")}`);
  const load = suite === "tasks" ? loadLocalTask : loadPolyglotTask;
  return Promise.all(ids.filter((id) => !only || only.includes(id)).map(load));
}

async function loadLocalTask(id: string): Promise<Task> {
  const dir = join(TASKS_DIR, id);
  const meta = await Bun.file(join(dir, "task.json")).json();
  return { id, language: "typescript", check: ["bun", "test"], protect: ["test"], hide: [], editFiles: [], repo: join(dir, "repo"), solution: [join(dir, "solution"), "."], ...meta };
}

/**
 * One Aider Polyglot exercise, set up the way Aider's benchmark/benchmark.py
 * does at Aider-AI/aider@38d4341e5976: the prompt is the docs plus Aider's
 * addendum, and .meta/, .docs/ and the tests are hidden from the agent.
 */
async function loadPolyglotTask(id: string): Promise<Task> {
  const [language, name] = id.split("/") as [string, string];
  const dir = join(POLYGLOT_DIR, language, "exercises/practice", name);
  const { files } = await Bun.file(join(dir, ".meta/config.json")).json();
  const editFiles = files.solution.map((f: string) => f.split("/").pop());
  const docs = async (f: string) => {
    const file = Bun.file(join(dir, ".docs", f));
    return (await file.exists()) ? file.text() : "";
  };
  const prompt =
    (await docs("introduction.md")) +
    (await docs("instructions.md")) +
    (await docs("instructions.append.md")) +
    `
####

Use the above instructions to modify the supplied files: ${editFiles.join(" ")}
Don't change the names of existing functions or classes, as they may be referenced from other code like unit tests, etc.
Only use standard libraries, don't suggest installing any packages.
`;
  // Aider's test commands. npm-test.sh's steps are inlined for JS; `timeout`
  // stops the container itself, since killing `docker run` would leave it running.
  const test =
    language === "python"
      ? "pytest -p no:cacheprovider"
      : "ln -sfn /npm-install/node_modules node_modules && sed -i 's/\\bxtest(/test(/g' *.spec.js && npm run test";
  const uid = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
  return {
    id,
    difficulty: "hard",
    language,
    prompt,
    check: ["sh", "-c", `docker run --rm --network none --user ${uid} -e HOME=/tmp -e PYTHONDONTWRITEBYTECODE=1 -v "$PWD":/work -w /work ${POLYGLOT_IMAGE} timeout 180 sh -c "$0"`, test],
    repo: dir,
    protect: files.test,
    hide: [".meta", ".docs", ...files.test],
    editFiles,
    solution: [join(dir, files.example[0]), files.solution[0]],
  };
}

async function sh(cmd: string[], cwd: string, env?: Record<string, string | undefined>, timeoutMs = 120_000) {
  const proc = Bun.spawn(cmd, { cwd, env: env ?? process.env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  return { code, stdout, stderr };
}

/**
 * Copies the task's repo into `ws` and commits it, so the agent's changes show
 * up as a diff. With `hideTests`, the protected paths are left out entirely.
 */
async function prepareWorkspace(task: Task, ws: string, hideTests = false): Promise<void> {
  await rm(ws, { recursive: true, force: true });
  await cp(task.repo, ws, { recursive: true });
  for (const p of [...task.hide, ...(hideTests ? task.protect : [])]) await rm(join(ws, p), { recursive: true, force: true });
  const git = ["git", "-c", "user.name=eval", "-c", "user.email=eval@localhost"];
  await sh([...git, "init", "-q"], ws);
  await sh([...git, "add", "-A"], ws);
  await sh([...git, "commit", "-qm", "task"], ws);
}

async function restoreProtected(task: Task, ws: string): Promise<void> {
  for (const p of task.protect) {
    await rm(join(ws, p), { recursive: true, force: true });
    await cp(join(task.repo, p), join(ws, p), { recursive: true });
  }
}

async function runCheck(task: Task, ws: string) {
  const r = await sh(task.check, ws, undefined, 200_000);
  return { passed: r.code === 0, code: r.code, output: r.stdout + r.stderr };
}

// ---------------------------------------------------------------------------
// self-check

async function selfCheck(suite: Suite, only?: string[]): Promise<boolean> {
  const tasks = await loadTasks(suite, only);
  const scratch = join(tmpdir(), `asr-eval-selfcheck-${process.pid}`);
  let ok = true;
  for (const task of tasks) {
    const ws = join(scratch, task.id);
    await prepareWorkspace(task, ws);
    await restoreProtected(task, ws);
    const before = await runCheck(task, ws);
    await cp(task.solution[0], join(ws, task.solution[1]), { recursive: true });
    const after = await runCheck(task, ws);
    const good = !before.passed && after.passed;
    ok &&= good;
    console.log(`${good ? "ok  " : "FAIL"}  ${task.id.padEnd(30)} ${task.difficulty.padEnd(5)} as given: ${before.passed ? "passes (should fail)" : "fails"}, with solution: ${after.passed ? "passes" : "fails (should pass)"}`);
    if (!after.passed) console.log(after.output.trim().split("\n").slice(-15).join("\n"));
  }
  await rm(scratch, { recursive: true, force: true });
  return ok;
}

// ---------------------------------------------------------------------------
// run

export interface RunResult {
  task: string;
  difficulty: Task["difficulty"];
  language: string;
  config: RouterConfig;
  rep: number;
  /** Final outcome; with --followup, after the follow-up turn if there was one. */
  solved: boolean;
  solvedFirst: boolean;
  turns: number;
  checkExit: number;
  opencodeExit: number | null;
  timedOut: boolean;
  budgetStopped: boolean;
  wallMs: number;
  /** Session ID printed by `opencode run`, and the session keys the proxy logged. */
  opencodeSession: string | null;
  sessionKeys: string[];
  requests: number;
  strongRequests: number;
  costUSD: number;
  allStrongCostUSD: number;
  inputTokens: number;
  cachedReadTokens: number;
  outputTokens: number;
  errors: number;
  /** Tier and reason of the first agent request (the turn-start decision). */
  startTier: string | null;
  startReason: string | null;
  /** Tier auto picked when the follow-up message arrived. */
  followupTier: string | null;
  escalated: boolean;
  diffStat: string;
  dir: string;
}

interface RunOptions {
  suite: Suite;
  mode: "mock" | "live";
  budget: number;
  tasks?: string[];
  configs: RouterConfig[];
  reps: number;
  timeoutSec: number;
  capture: boolean;
  hideTests: boolean;
  followup: boolean;
}

/** Aider's second-try message (benchmark/prompts.py test_failures) after the test output. */
function followupPrompt(task: Task, output: string): string {
  // ponytail: keeps the last 20k chars; Aider sends the output uncapped.
  const out = output.length > 20_000 ? output.slice(-20_000) : output;
  return `${out.replace(/\bin \d+\.\d+s\b/g, "")}
####

See the testing errors above.
The tests are correct, don't try and change them.
Fix the code${task.editFiles.length ? ` in ${task.editFiles.join(" ")}` : ""} to resolve the errors.
`;
}

function findSessionId(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    const m = line.match(/"sessionID"\s*:\s*"([^"]+)"/);
    if (m) return m[1]!;
  }
  return null;
}

async function run(opts: RunOptions): Promise<void> {
  const tasks = await loadTasks(opts.suite, opts.tasks);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = join(RUNS_DIR, stamp);
  // Workspaces and OpenCode's HOME live outside this repo, so OpenCode doesn't
  // pick up this project's AGENTS.md / CLAUDE.md or the user's skills and config.
  const scratch = join(tmpdir(), `asr-eval-${stamp}`);
  const home = join(scratch, "home");
  await mkdir(runDir, { recursive: true });
  await mkdir(home, { recursive: true });

  const mock = opts.mode === "mock" ? startMockUpstream() : null;
  const cfg = await loadConfig(CONFIG_PATH, {
    port: 0,
    ...(mock ? { upstream: { baseURL: mock.baseURL, auth: "inject" as const } } : {}),
    log: { path: join(runDir, "decisions.jsonl"), captureBodies: opts.capture, captureDir: join(runDir, "captures") },
  });
  let cachedKey: Promise<string | null> | null = null;
  const apiKey = mock ? async () => "mock" : () => (cachedKey ??= resolveApiKey(cfg));
  if (!(await apiKey())) throw new Error(`no upstream API key (set ${cfg.upstream.apiKeyEnv} or connect Zen in OpenCode)`);

  // Spend tracking. The guard refuses upstream calls once the budget is used up,
  // so the overshoot is at most the requests already in flight.
  let spent = 0;
  let inFlight = 0;
  let current: { lines: DecisionLogLine[]; proc: ReturnType<typeof Bun.spawn> | null; budgetStopped: boolean } | null = null;
  const guardedFetch = (async (input: any, init?: any) => {
    if (spent >= opts.budget) {
      return Response.json({ error: { message: `eval budget of $${opts.budget} used up` } }, { status: 402 });
    }
    inFlight++;
    return fetch(input, init);
  }) as typeof fetch;
  const server = startServer(cfg, {
    apiKey,
    fetch: guardedFetch,
    onLogged: (line) => {
      if (line.status !== 402) inFlight = Math.max(0, inFlight - 1);
      spent += line.costUSD ?? 0;
      current?.lines.push(line);
      if (spent >= opts.budget && current && !current.budgetStopped) {
        current.budgetStopped = true;
        current.proc?.kill();
      }
    },
  });

  // OpenCode's global config in the isolated HOME: the example provider pointed at this proxy.
  const example = await Bun.file(join(ROOT, "examples/opencode.jsonc")).text();
  const ocConfigDir = join(home, ".config/opencode");
  await mkdir(ocConfigDir, { recursive: true });
  await writeFile(join(ocConfigDir, "opencode.jsonc"), example.replace("http://127.0.0.1:8787/v1", `http://127.0.0.1:${server.port}/v1`));

  const env = {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local/share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local/state"),
    TERM: "dumb",
    ASR_CLIENT_KEY: "unused",
  };
  const opencode = Bun.which("opencode", { PATH: process.env.PATH }) ?? join(process.env.HOME ?? "", ".opencode/bin/opencode");

  await writeFile(
    join(runDir, "run.json"),
    JSON.stringify({ ...opts, started: new Date().toISOString(), tasks: tasks.map((t) => t.id), tiers: cfg.tiers, policy: cfg.policy }, null, 2),
  );
  console.log(`eval run ${stamp} (${opts.mode}${opts.mode === "live" ? `, budget $${opts.budget}` : ""}) → ${runDir}`);

  const results: RunResult[] = [];
  outer: for (let rep = 1; rep <= opts.reps; rep++) {
    for (const [ti, task] of tasks.entries()) {
      // Rotate the config order per task so no config always runs first.
      const order = opts.configs.map((_, i) => opts.configs[(i + ti + rep) % opts.configs.length]!);
      for (const config of order) {
        if (spent >= opts.budget) {
          console.log(`budget reached ($${spent.toFixed(4)} of $${opts.budget}); stopping`);
          break outer;
        }
        const dir = join(runDir, task.id, `${config}-r${rep}`);
        const ws = join(scratch, "ws", task.id, `${config}-r${rep}`);
        await mkdir(dir, { recursive: true });
        await prepareWorkspace(task, ws, opts.hideTests);

        current = { lines: [], proc: null, budgetStopped: false };
        const started = performance.now();
        let prompt = opts.hideTests ? (task.hiddenPrompt ?? task.prompt) : task.prompt;
        let [stdout, stderr, session, timedOut, turns] = ["", "", null as string | null, false, 0];
        let exit: number | null = null;
        let diffStat = "";
        let check: Awaited<ReturnType<typeof runCheck>>;
        let solvedFirst = false;
        // Turn 1 is the task. With --followup, a failed turn 1 gets one more user
        // message in the same session: the test output, as Aider's second try sends it.
        while (true) {
          turns++;
          const proc = Bun.spawn(
            [opencode, "run", "--standalone", "--auto", "--format", "json", "--print-logs", "--log-level", "error", ...(session ? ["--session", session] : []), "-m", `router/${config}`, prompt],
            { cwd: ws, env, stdout: "pipe", stderr: "pipe" },
          );
          current.proc = proc;
          const timer = setTimeout(() => {
            timedOut = true;
            proc.kill();
          }, opts.timeoutSec * 1000);
          const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
          clearTimeout(timer);
          [stdout, stderr, exit] = [stdout + out, stderr + err, code];
          session ??= findSessionId(out);
          // Log lines are written after each response stream ends; wait for stragglers.
          for (let i = 0; i < 100 && inFlight > 0; i++) await Bun.sleep(100);

          await sh(["git", "add", "-A"], ws);
          const diff = await sh(["git", "diff", "--cached"], ws);
          diffStat = (await sh(["git", "diff", "--cached", "--shortstat"], ws)).stdout.trim();
          await writeFile(join(dir, "diff.patch"), diff.stdout);
          await restoreProtected(task, ws);
          check = await runCheck(task, ws);
          await writeFile(join(dir, turns === 1 ? "check.txt" : `check-${turns}.txt`), check.output);
          if (turns === 1) solvedFirst = check.passed;
          if (check.passed || !opts.followup || turns === 2 || current.budgetStopped || timedOut || !session) break;
          for (const p of [...task.hide, ...(opts.hideTests ? task.protect : [])]) await rm(join(ws, p), { recursive: true, force: true });
          prompt = followupPrompt(task, check.output);
        }
        const wallMs = Math.round(performance.now() - started);
        const { lines, budgetStopped } = current;
        current = null;

        await writeFile(join(dir, "opencode.jsonl"), stdout);
        await writeFile(join(dir, "opencode.err.log"), stderr);

        const totals = aggregate(lines).total;
        const [start, followupStart] = lines.filter((l) => l.kind === "agent" && l.isTurnStart);
        const result: RunResult = {
          task: task.id,
          difficulty: task.difficulty,
          language: task.language,
          config,
          rep,
          solved: check.passed,
          solvedFirst,
          turns,
          checkExit: check.code,
          opencodeExit: exit,
          timedOut,
          budgetStopped,
          wallMs,
          opencodeSession: session,
          sessionKeys: [...new Set(lines.map((l) => l.sessionKey).filter((k): k is string => !!k))],
          requests: totals.requests,
          strongRequests: totals.strongRequests,
          costUSD: totals.costUSD,
          allStrongCostUSD: totals.allStrongCostUSD,
          inputTokens: totals.inputTokens,
          cachedReadTokens: totals.cachedReadTokens,
          outputTokens: totals.outputTokens,
          errors: totals.errors,
          startTier: start?.tier ?? null,
          startReason: start?.reason ?? null,
          followupTier: followupStart?.tier ?? null,
          escalated: lines.some((l) => l.reason?.startsWith("escalate:")),
          diffStat,
          dir,
        };
        results.push(result);
        await writeFile(join(dir, "result.json"), JSON.stringify(result, null, 2));
        await Bun.write(join(runDir, "results.jsonl"), results.map((r) => JSON.stringify(r)).join("\n") + "\n");
        const flags = [turns > 1 && `turn2=${result.followupTier}`, timedOut && "TIMEOUT", budgetStopped && "BUDGET", result.escalated && "escalated", exit !== 0 && `exit=${exit}`].filter(Boolean);
        console.log(
          `${result.solved ? "PASS" : "fail"}  ${task.id.padEnd(30)} ${config.padEnd(6)} r${rep}  $${result.costUSD.toFixed(4)}  ${(wallMs / 1000).toFixed(0)}s  ${result.requests} req  start=${result.startTier ?? "-"}  total=$${spent.toFixed(4)}  ${flags.join(" ")}`,
        );
      }
    }
  }

  server.stop(true);
  mock?.server.stop(true);
  await rm(scratch, { recursive: true, force: true });
  const summary = summarize(results);
  await writeFile(join(runDir, "summary.md"), summary);
  console.log("\n" + summary);
}

// ---------------------------------------------------------------------------
// summary

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : 0;
};

function table(header: string[], rows: string[][]): string {
  return [header, header.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
}

export function summarize(results: RunResult[]): string {
  const lang = (r: RunResult) => r.language ?? "typescript"; // runs before 2026-10-17 have no language
  const languages = [...new Set(results.map(lang))].sort();
  const followups = results.some((r) => (r.turns ?? 1) > 1);
  const configs = CONFIGS.filter((c) => results.some((r) => r.config === c));
  const byConfig = configs.map((c) => {
    const rs = results.filter((r) => r.config === c);
    const solved = rs.filter((r) => r.solved).length;
    const cost = rs.reduce((s, r) => s + r.costUSD, 0);
    const easy = rs.filter((r) => r.difficulty === "easy");
    const hard = rs.filter((r) => r.difficulty === "hard");
    const reqs = rs.reduce((s, r) => s + r.requests, 0);
    const strong = rs.reduce((s, r) => s + r.strongRequests, 0);
    const input = rs.reduce((s, r) => s + r.inputTokens, 0);
    const cached = rs.reduce((s, r) => s + r.cachedReadTokens, 0);
    return [
      c,
      `${solved}/${rs.length} (${pct(solved, rs.length)})`,
      ...(followups ? [`${rs.filter((r) => r.solvedFirst).length}/${rs.length}`] : []),
      `${easy.filter((r) => r.solved).length}/${easy.length}`,
      `${hard.filter((r) => r.solved).length}/${hard.length}`,
      ...(languages.length > 1 ? languages.map((l) => `${rs.filter((r) => lang(r) === l && r.solved).length}/${rs.filter((r) => lang(r) === l).length}`) : []),
      usd(cost),
      solved ? usd(cost / solved) : "-",
      `${(median(rs.map((r) => r.wallMs)) / 1000).toFixed(0)}s`,
      pct(strong, reqs),
      pct(cached, input),
      String(rs.filter((r) => r.escalated).length),
      String(rs.reduce((s, r) => s + r.errors, 0)),
      String(rs.filter((r) => r.timedOut || r.budgetStopped).length),
    ];
  });

  const tasks = [...new Set(results.map((r) => r.task))];
  const cell = (rs: RunResult[]) =>
    rs.length ? `${rs.filter((r) => r.solved).length}/${rs.length} ${usd(rs.reduce((s, r) => s + r.costUSD, 0) / rs.length)}` : "";
  const perTask = tasks.map((t) => {
    const rs = results.filter((r) => r.task === t);
    const auto = rs.filter((r) => r.config === "auto");
    const autoStart = [...new Set(auto.map((r) => `${r.startTier ?? "-"}${r.escalated ? "→esc" : ""}${r.followupTier ? `, turn 2: ${r.followupTier}` : ""}`))].join(", ");
    return [t, lang(rs[0]!), rs[0]!.difficulty, ...configs.map((c) => cell(rs.filter((r) => r.config === c))), autoStart || "-"];
  });

  const total = results.reduce((s, r) => s + r.costUSD, 0);
  return [
    `# Eval summary`,
    ``,
    `${results.length} run(s), total spend ${usd(total)}.`,
    ``,
    table(["config", "solved", ...(followups ? ["1st turn"] : []), "easy", "hard", ...(languages.length > 1 ? languages : []), "cost", "$/solved", "median wall", "% strong reqs", "cache read", "escalated", "req errors", "cut short"], byConfig),
    ``,
    `Per task (solved/runs, mean cost per run; "auto start" is the tier auto picked at turn start):`,
    ``,
    table(["task", "language", "difficulty", ...configs, "auto start"], perTask),
    ``,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// CLI

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const list = (s: string | undefined) => s?.split(",").map((x) => x.trim()).filter(Boolean);

if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2);
  const suite = (flag(args, "--suite") ?? "tasks") as Suite;
  if (!SUITES.includes(suite)) {
    console.error(`unknown suite: ${suite} (one of ${SUITES.join(", ")})`);
    process.exit(1);
  }
  switch (cmd) {
    case "list":
      for (const t of await loadTasks(suite)) console.log(`${t.id.padEnd(30)} ${t.difficulty.padEnd(5)} ${t.prompt.split("\n")[0]}`);
      break;
    case "self-check":
      process.exit((await selfCheck(suite, list(flag(args, "--tasks")))) ? 0 : 1);
    case "run": {
      const mock = args.includes("--mock");
      const live = args.includes("--live");
      const budget = Number(flag(args, "--budget"));
      if (mock === live) {
        console.error("choose exactly one of --mock or --live\n\n" + USAGE);
        process.exit(1);
      }
      if (live && !(budget > 0)) {
        console.error("--live needs --budget USD (a positive number)");
        process.exit(1);
      }
      const configs = (list(flag(args, "--configs")) ?? [...CONFIGS]) as RouterConfig[];
      const bad = configs.filter((c) => !CONFIGS.includes(c));
      if (bad.length) {
        console.error(`unknown config(s): ${bad.join(", ")}`);
        process.exit(1);
      }
      await run({
        suite,
        mode: mock ? "mock" : "live",
        budget: live ? budget : Infinity,
        tasks: list(flag(args, "--tasks")),
        configs,
        reps: Number(flag(args, "--reps") ?? 1),
        timeoutSec: Number(flag(args, "--timeout") ?? 600),
        capture: args.includes("--capture"),
        hideTests: args.includes("--hide-tests"),
        followup: args.includes("--followup"),
      });
      break;
    }
    case "summarize": {
      const dir = args[0];
      if (!dir) {
        console.error(USAGE);
        process.exit(1);
      }
      const text = await Bun.file(join(dir, "results.jsonl")).text();
      const results = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as RunResult);
      const summary = summarize(results);
      await writeFile(join(dir, "summary.md"), summary);
      console.log(summary);
      break;
    }
    default:
      console.log(USAGE);
      process.exit(cmd && cmd !== "help" && cmd !== "--help" ? 1 : 0);
  }
}
