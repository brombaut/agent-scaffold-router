# 06 — Evaluation harness and first live results

**Date:** 2026-10-14 (the harness was built on 2026-10-07)
**Phase:** Child #5 (evaluation harness) of the [epic spec](../specs/001-epic-agent-scaffold-router.md), on branch `feat/05-eval-harness` and not merged yet
**Previous:** [report 05](05_progress_report.md) (overview of 00–04), [report 04](04_progress_report.md) (v1 complete)

## What we did

1. **Built the eval harness** (`eval/`, commit `2b4cfa9`). For each rep × task × config, it:
   - copies a task repo into a fresh git workspace in `$TMPDIR`;
   - runs `opencode run -m router/<auto|strong|weak>` against an in-process proxy, with HOME and XDG pointed at a temp dir;
   - restores the protected `test/` dir and runs `bun test` to decide whether the task was solved;
   - attributes the proxy's log lines to the run.

   Details are in [`eval/README.md`](../../eval/README.md).
2. **Wrote 12 small TypeScript tasks.** Each has a failing test, a natural-sounding prompt and a reference solution. Six are easy and six are hard.
3. **Did the zero-cost checks.**
   - `self-check`: all 12 tasks fail as given and pass with their solution.
   - `run --mock` ran end to end.
   - The 54 unit tests and the typecheck pass.
4. **Ran a paid pilot** (2026-10-14): `greeting-typo` and `lru-cache`, 3 configs, 1 rep. It cost $0.05.
5. **Ran the full paid eval** (2026-10-14): 12 tasks × 3 configs × 3 reps, or 108 runs. It cost $1.19 and took 39 minutes of agent wall time.
   - Output: `eval/runs/2026-10-14T22-20-44/` (gitignored).

## Issues encountered

- **The repo's own `bun test` picked up the task repos** and showed 32 failures in CI. Fixed with `bunfig.toml` setting `[test] root = "test"`.
- **OpenCode v2 loads skills from `~/.claude/skills`,** so every agent prompt carried gstack's skills. The eval runs OpenCode with an isolated HOME, which brings the agent request down to about 21 KB with no gstack content.
- **The tasks turned out too easy** (see Results). This is the main problem with this round.
- **Subagent prompts are scored as new turns.**
  - In `deep-merge` auto r2, the weak model started an `explore` subagent with the prompt "…Determine **why** withDefaults is non-idempotent…".
  - That prompt is the latest user-role item, so `decide()` (`src/router/policy.ts:81`) scored it 4 and routed the subagent's 4 requests to strong. Routing then went back to weak.
  - So read-only exploration ran on the expensive model while the main work ran on the cheap one, which is the opposite of what we want.
- **The escalation rule probably misfires on file contents.** Both escalations (`async-fetch-all` r1 and r2) fired on `escalate:tool_errors=3`.
  - That task's source and test files contain the word "error", and `bun test` output contains "fail". Three such outputs in a row trigger the rule.
  - The weak model solves this task 3/3 without help, so both escalations were wasted. This matches the open question in [`HANDOFF.md`](../HANDOFF.md) §9. I haven't checked it item by item.
- **One weak run looped.** `lru-cache` auto r2 took 192s and produced 34k output tokens, but still solved the task.
- **The one failure was a give-up.** `token-bucket` weak r2 stopped after 3.8s and 5 requests, with an empty diff.

## Decisions and rationale

| Decision | Alternatives | Why |
|---|---|---|
| Write our own small TypeScript tasks (2026-10-07). | SWE-bench subset | Cheap, fast, fully under our control, and they run in Bun with no Docker. SWE-bench can be added later if the blog post needs outside credibility. |
| Keep the task prompts realistic and don't tune them to the heuristic's keywords. | Prompts that hit the keywords | We want to measure the router on how people actually write. As a result, 11 of 12 tasks start on weak, so the eval mainly tests escalation. |
| $5 eval budget, enforced by a proxy-side guard that returns HTTP 402, with no live runs without an explicit go. | Trust the estimate | Live runs spend real credit, and the guard is a hard stop even if a run loops. |
| Protect `test/` by restoring it before the check. | Trust the agent | Otherwise editing the test would count as a solve. |
| Run a pilot first (2 tasks), then the full run (`--reps 3 --budget 2`). | Go straight to the full run | The pilot showed costs about 5× below the estimate and no hangs, which justified 3 reps at about $1 instead of the planned 2. |
| Don't add an events log for rejected or in-flight requests (2026-10-07). | Harden the logging | The user decided the current `decisions.jsonl` is enough. |
| **Next: write harder tasks before any more paid runs.** | Re-run with more reps; change the router first | Quality is flat across configs, so more reps or router changes can't show anything until some tasks actually separate weak from strong. |

## Results

Full run, `eval/runs/2026-10-14T22-20-44/summary.md`:

| config | solved | easy | hard | cost | $/solved | median wall | % strong reqs | escalated |
|---|---|---|---|---|---|---|---|---|
| strong | 36/36 | 18/18 | 18/18 | $0.89 | $0.025 | 17s | 87% | 0 |
| auto | 36/36 | 18/18 | 18/18 | $0.24 | $0.007 | 12s | 16% | 2 |
| weak | 35/36 | 18/18 | 17/18 | $0.06 | $0.002 | 13s | 0% | 0 |

- **The weak model solves 97% of the tasks**, including 17 of 18 hard runs. At this difficulty, routing can only add cost: auto is about 4× the cost of weak and gives no quality gain.
- **Auto is 73% cheaper than strong** at equal quality. But that saving comes from the tasks being easy, not from the router choosing well.
- **The strong config sends only 87% of its requests to strong** because OpenCode itself asks for `router/weak` for title requests (the `title` agent in `examples/opencode.jsonc`).
- Prompt-cache read rates are 76–82% in every config.
- **Most of auto's extra cost over weak** comes from `emitter-once` (keyword start on strong), the 2 `async-fetch-all` escalations, and the subagent misroute in `deep-merge`.

So far $1.24 of the $5 eval budget is spent, and $3.76 remains.

## Open questions / next steps

1. **Write 4–6 genuinely hard tasks**, aiming for the weak model to solve under 50%. Then do a small paid check of weak vs strong on those tasks only, after the user's go.
2. **Subagent routing.** My proposal: give subagent requests the parent turn's tier instead of scoring their prompt. Needs a decision.
3. **Escalation false positives.** Count tool errors only from command outputs (non-zero exit), not from file reads that happen to contain "error".
4. Whether to merge `feat/05-eval-harness` now or after the harder tasks.
5. Still open from earlier: the root cause of the `opencode run` hang without `--print-logs`, and compaction going to strong without evidence (no task here was long enough to trigger compaction).
