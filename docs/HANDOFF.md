# Handoff: agent-scaffold-router

**For:** the next agent picking up this repo

**Updated:** 2026-10-26; replaces the 2026-10-19 handoff. Live service/config details below were last verified **2026-10-19**, not reverified during this cleanup.

**Read first:** this file, [`AGENTS.md`](../AGENTS.md), [`CLAUDE.md`](../CLAUDE.md), then the [README](../README.md) and [`examples/opencode.jsonc`](../examples/opencode.jsonc) for current setup. Reports [07](progress/07_progress_report.md)–[09](progress/09_progress_report.md) cover Polyglot, the classifier and experiment; [10](progress/10_progress_report.md) covers the dashboard, [11](progress/11_progress_report.md) the audit, [12](progress/12_progress_report.md) the cleanup and [13](progress/13_progress_report.md) the idle timeline fix. For earlier history, report [05](progress/05_progress_report.md) summarizes 00–04, and [06](progress/06_progress_report.md) covers local eval findings.

## 1. Where we are

A local HTTP proxy between OpenCode v2 and OpenCode Zen. For each **user turn** it routes to a strong model (`gpt-6.1-sol`) or a weak one (`gpt-6-luna`) and logs every request with its cost.

```
 v1 proxy ─ eval harness ─ Polyglot eval ─ classifier ─ everyday experiment ─ analysis
    ✓            ✓              ✓        ✓ negative       collecting*       PENDING
                                          on Polyglot
 * Experiment setup last verified Oct 19; no fresh service check in this cleanup.
```

- **v1 (children #1–#4)** and **the eval harness (#5)** are on `main`.
- **Eval findings (reports 06–07):** on our own tasks weak solves ~97%, so routing only adds cost. On a 60-exercise Aider Polyglot subset: strong 48/60 $1.87, auto 28/60 $0.66, weak 20/60 $0.14. Escalation never fired; the turn-start pick decides quality.
- **Classifier (reports 08–09):** one model call per turn answering weak/strong. On Polyglot it tied the keyword heuristic and was no better than chance; that line stopped by a pre-agreed rule. It was then wired into the everyday-use experiment: each session is assigned `on` (classifier routes) or `shadow` (heuristic routes, classifier logged).
- **Dashboard and audit (reports 10–13):** the separate read-only local dashboard includes a live call timeline. Report 13 fixes the timeline's idle-time freeze with a clock-driven frontend update. Dashboard source/tests, CLI and README changes were WIP at audit time; they are included with the cleanup commit. The verified working-tree baseline is **71 passing tests**. Experiment analysis is still pending.

## 2. Rules you must follow

- **Progress reports.** Cleanup is recorded in report 12; next is `docs/progress/13_progress_report.md`. Write one at real milestones, including experiment analysis when requested. Never edit past reports except to fix factual errors. **Decisions and rationale** matters most.
- **Git.** Work on **`main`**; no feature branches (user's standing instruction, replaces the old branch workflow). Commit or push only when asked.
- **Don't start a proposed step without an explicit go.** A clarification or "makes sense" is not a go. Audit bug fixes are deferred, not authorized by the documentation/low-risk cleanup approval.
- **Money and secrets.** No paid run without a fresh explicit go and an agreed `--budget`. Recorded live eval spend through report 09: **$4.72**. Everyday use spends the user's credit separately. Never print the Zen key: `opencode auth export` is parsed in-process (`src/auth.ts`); don't `cat` `~/.config/opencode/service.json` or `~/.local/share/opencode/auth.json`.
- **Experiment integrity.** Do not change routing rules, classifier behavior/prompt or experiment mode while data is being collected unless explicitly approved. Keep one general `CLASSIFIER_INSTRUCTIONS`, never tuned against eval results. Compare any per-turn rule with one model per session (cache reads were 76–82% of input tokens).

## 3. The everyday experiment

**Historical operational snapshot — last verified 2026-10-19 (report 09).** The audit and cleanup did not recheck the service, local configuration or log contents. Do not treat this table as a current health check or restart instruction.

| Thing | Recorded location / setup |
|---|---|
| Service | `~/.config/systemd/user/agent-scaffold-router.service` (copy of `examples/`), running `bun src/cli.ts serve` **from this checkout**. Source edits only reach the running proxy after a restart; do not restart without approval. |
| Router config | `~/.config/agent-scaffold-router/config.json` = `{"policy":{"classifier":{"mode":"experiment"}}}` |
| OpenCode config | `~/.config/opencode/opencode.jsonc` = `examples/opencode.jsonc` (default model `router/auto`). Previous at `opencode.jsonc.bak` |
| Log | `~/.local/share/agent-scaffold-router/decisions.jsonl`. The first 48 lines were recorded as pre-experiment entries from 2026-10-03. |

**Analysis remains pending (when the user asks):** take turn-start lines with an `arm` field. Fields: `arm` (on/shadow), `classifierTier`, `heuristicTier`, `tier`, `reason`, `classifierCostUSD`, `classifierRaw`, `turnPreview` (first 500 chars of the message; private, keep it local). Compare arms on:
- cost per session (`bun src/cli.ts report --json`);
- `!strong`/`!weak` overrides;
- pushback in the next turn's `turnPreview` ("wrong", "still broken", pasted errors);
- tier flips within a session (cache loss);
- classifier vs heuristic disagreement, and what the disagreeing messages look like.

The dashboard can inspect the existing log without restarting the proxy: `bun src/cli.ts dashboard` serves on `http://127.0.0.1:8788`. It shows recorded behavior, not proof that either arm produces better task outcomes. See the [README](../README.md#local-dashboard) for usage and privacy limitations.

## 4. Code map

| Path | What |
|---|---|
| `src/cli.ts` | `serve`, `report`, `dashboard` entry points |
| `src/server.ts` | Proxy HTTP server, turn bookkeeping, classifier scheduling (`classifyTurn`, `armFor`) |
| `src/router/policy.ts`, `src/router/classifier.ts` | Overrides, heuristic/classifier tier, escalation; classifier call and fail-open behavior |
| `src/upstream.ts`, `src/sse.ts` | Zen forwarding, streaming/usage parsing, decision logging (including shadow `late` fields) |
| `src/log/`, `src/report.ts` | Decision log, pricing and report aggregation |
| `src/dashboard/server.ts` | Separate read-only local dashboard server and API |
| `src/dashboard/data.ts`, `src/dashboard/index.html` | Dashboard aggregation and browser UI, including live routing timeline |
| `test/dashboard.test.ts` | Dashboard data/server tests; part of the existing uncommitted WIP |
| `eval/run.ts` | Eval CLI: `list`, `self-check`, `run --mock \| --live --budget`, `summarize`; `--suite tasks\|polyglot`, optional `--followup`. Forces classifier off despite loaded config. |
| `eval/replay.ts`, `eval/classify.ts` | Free replay pricing; separate paid classifier prompt evaluation |
| `eval/polyglot.sh`, `eval/polyglot.Dockerfile`, `eval/polyglot-subset.txt` | Polyglot setup; subset is fixed, don't regenerate |
| `docs/specs/` | Historical designs: 001 epic, 002 Polyglot eval, 003 turn-start decision; current configuration is in README/examples |

Validation baseline after the dashboard idle-timeline fix ([report 13](progress/13_progress_report.md)): `bun test` **71 passed, 0 failed** across 8 files; `bun run typecheck` passed. The audit also checked all 17 local eval reference fixtures. No paid evaluation was needed.

## 5. Next steps

1. **When the user asks, analyze the everyday experiment** (§3; target ~30+ sessions). Do not mistake report 10's dashboard work for that analysis. Write the next available numbered report (13 after cleanup).
2. **Deferred audit bugs:** report 11 records dashboard temp-dir portability and generic cleanup, string-input override stripping, classifier parsing/auth edge cases, chained-session state and replay missing-data handling. Report 13 fixed the idle timeline freeze. Routing/classifier changes need separate approval because they would affect experiment comparability.
3. **Unanswered paid proposal:** a `--followup` Polyglot run to measure pushback and per-turn vs per-session routing. Needs a go and a budget. Signals available only after weak has tried (e.g. cheap review of its diff) need such data first.

## 6. Environment

**Historical environment snapshot (2026-10-19), not reverified during the audit/cleanup:**

| Thing | Recorded location / version |
|---|---|
| Bun 1.4.2 | `~/.bun/bin/bun`, on PATH in all shells |
| OpenCode v2.0.22 | `~/.opencode/bin/opencode`; add `~/.opencode/bin` to PATH for eval |
| Zen credential | Stored in OpenCode; the proxy reads it via `opencode auth export`. `OPENCODE_API_KEY` was not set. |
| Docker image `asr-polyglot` | Built by `eval/polyglot.sh`; runs Polyglot checks with `--network none` |
| Eval output | `eval/runs/` (gitignored). Polyglot paid run: `eval/runs/2026-10-17T23-33-02/` |

## 7. Gotchas

1. **OpenCode invocation/history.** Always pass `--print-logs` to `opencode run`, or it may hang (cause unknown). 3/180 Polyglot runs also exited with `InterruptError` after ~60s; not investigated. OpenCode v2 loads `~/.claude/skills` in everyday sessions; eval isolates HOME.
2. **Service safety.** The recorded service uses port 8787; a second manual proxy may clash. Eval uses a random port (`port: 0`). Don't `pkill -f 'src/cli.ts serve'` from a shell containing that string, and don't restart the service as part of cleanup. The dashboard uses a separate port/server.
3. **Upstream compatibility.** Don't remove `dropForeignReasoning`, or Luna → Sol switches fail with HTTP 400. Zen can return HTTP 200 with an in-stream `error` event.
4. **Eval interpretation.** `run --mock` costs are fake. `eval/run.ts` forces the classifier off even if the everyday config enables it. Polyglot is one try by default; `--followup` is optional. See [eval README](../eval/README.md).
5. **Heuristic limitations.** `files=` counts paths in pasted tracebacks, so long pasted errors tend to score strong (report 08). Audit edge cases are listed in report 11, not resolved by a green baseline.

## 8. User preferences

- Short, intuitive explanations; ASCII diagrams when they help.
- Wants things simple and not overfit to the eval.
- Makes the calls on spending, merging and publishing (package is `private`).
- Prefers realistic prompts over ones tuned to the router.
