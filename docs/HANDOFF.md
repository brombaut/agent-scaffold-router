# Handoff: agent-scaffold-router

**For:** the next agent picking up this repo
**Written:** 2026-10-19. It replaces the 2026-10-07 version.
**Read first:** this file, then [`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](../CLAUDE.md), then progress reports [05](progress/05_progress_report.md) (overview of 00–04) and [06](progress/06_progress_report.md)–[09](progress/09_progress_report.md).

## 1. Where we are

A local HTTP proxy between OpenCode v2 and OpenCode Zen. For each **user turn** it routes to a strong model (`gpt-6.1-sol`) or a weak one (`gpt-6-luna`) and logs every request with its cost.

```
 v1 proxy ─ eval harness ─ Polyglot eval ─ classifier (spec 003) ─ everyday experiment ─ analysis
    ✓            ✓              ✓          ✓ negative on Polyglot     ▶ RUNNING (user)      NEXT
```

- **v1 (children #1–#4)** and **the eval harness (#5)** are on `main`.
- **Eval findings (reports 06–07):** on our own tasks weak solves ~97%, so routing only adds cost. On a 60-exercise Aider Polyglot subset: strong 48/60 $1.87, auto 28/60 $0.66, weak 20/60 $0.14. Escalation never fired; the turn-start pick decides quality.
- **Classifier (report 08):** one cheap model call per turn answering weak/strong. On Polyglot it tied the keyword heuristic and was no better than chance. Line stopped on Polyglot by a pre-agreed rule.
- **Now (report 09):** the classifier is wired into the proxy, and the user is running an **everyday-use experiment** on their own work: the proxy runs as a systemd user service in `experiment` mode, where each OpenCode session is randomly `on` (classifier routes) or `shadow` (heuristic routes, classifier logged).

## 2. Rules you must follow

- **Progress reports.** Next file is `docs/progress/10_progress_report.md`. Write one at real milestones (the experiment analysis is the next one). Never edit past reports except to fix factual errors. **Decisions and rationale** matters most.
- **Git.** Work and commit **on `main`**; no feature branches (user's standing instruction, replaces the old branch workflow). Commit or push only when asked. Commit messages end with the `Co-Authored-By` line from the system prompt.
- **Don't start a proposed step without an explicit go.** A clarification or "makes sense" is not a go.
- **Money.** No paid run without a fresh explicit go and an agreed `--budget`. Total live eval spend so far: **$4.72**. The everyday experiment spends the user's credit through normal use; that's theirs.
- **Secrets.** Never print the Zen key. `opencode auth export` output is parsed in-process only (`src/auth.ts`). Don't `cat` `~/.config/opencode/service.json` or `~/.local/share/opencode/auth.json`.
- **Eval hygiene.** One general classifier prompt (`CLASSIFIER_INSTRUCTIONS`), never tuned against eval results. Any per-turn rule must be compared with keeping one model per session (prompt cache: cache reads are 76–82% of input tokens).

## 3. The running experiment

| Thing | Where |
|---|---|
| Service | `~/.config/systemd/user/agent-scaffold-router.service` (copy of `examples/`), runs `bun src/cli.ts serve` **from this checkout**, so code changes need `systemctl --user restart agent-scaffold-router` |
| Router config | `~/.config/agent-scaffold-router/config.json` = `{"policy":{"classifier":{"mode":"experiment"}}}` |
| OpenCode config | `~/.config/opencode/opencode.jsonc` = `examples/opencode.jsonc` (default model `router/auto`). Previous at `opencode.jsonc.bak` |
| Log | `~/.local/share/agent-scaffold-router/decisions.jsonl`. The first 48 lines are from 2026-10-03, before the experiment |

**Don't change the mode, the classifier prompt or the routing rules while the experiment runs** unless the user asks; it would split the data.

**Analysis (when the user asks):** take turn-start lines with an `arm` field. Fields: `arm` (on/shadow), `classifierTier`, `heuristicTier`, `tier`, `reason`, `classifierCostUSD`, `classifierRaw`, `turnPreview` (first 500 chars of the message; private, keep it local). Compare arms on:
- cost per session (`bun src/cli.ts report --json`);
- `!strong`/`!weak` overrides;
- pushback in the next turn's `turnPreview` ("wrong", "still broken", pasted errors);
- tier flips within a session (cache loss);
- classifier vs heuristic disagreement, and what the disagreeing messages look like.

## 4. Code map

| Path | What |
|---|---|
| `src/server.ts` | HTTP server, turn bookkeeping, classifier scheduling (`classifyTurn`, `armFor`) |
| `src/router/policy.ts` | `route`/`decide`: overrides, heuristic score, classifier tier, escalation |
| `src/router/classifier.ts` | `classify()`; fails open to strong |
| `src/upstream.ts` | Forwards to Zen, streams back, writes the log line (merges the shadow `late` fields) |
| `src/log/`, `src/report.ts` | Decision log, cost, `report` |
| `eval/run.ts` | Eval CLI: `list`, `self-check`, `run --mock \| --live --budget`, `summarize`; `--suite tasks\|polyglot`, `--followup` |
| `eval/replay.ts` | Free replay: price any per-task tier pick against a finished run |
| `eval/classify.ts` | Paid: run the classifier over a suite's prompts |
| `eval/polyglot.sh`, `eval/polyglot.Dockerfile`, `eval/polyglot-subset.txt` | Polyglot setup; the subset is fixed, don't regenerate |
| `docs/specs/` | 001 epic, 002 Polyglot eval, 003 turn-start decision |

CI: `bun test && bun run typecheck` (58 tests).

## 5. Next steps

1. **Wait for the user** to collect data (~30+ sessions), then analyze (§3) and write report 10.
2. **Unanswered proposal:** a paid `--followup` Polyglot run to measure pushback and per-turn vs per-session routing. Needs a go and a budget.
3. Signals only available after weak has tried (e.g. a cheap review of its diff), once `--followup` data exists.

## 6. Environment

| Thing | Where / how |
|---|---|
| Bun 1.4.2 | `~/.bun/bin/bun`, on PATH in all shells |
| OpenCode v2.0.22 | `~/.opencode/bin/opencode`; add `~/.opencode/bin` to PATH for the eval |
| Zen credential | Stored in OpenCode; the proxy reads it via `opencode auth export`. `OPENCODE_API_KEY` isn't set |
| Docker image `asr-polyglot` | Built by `eval/polyglot.sh`; runs Polyglot checks with `--network none` |
| Eval output | `eval/runs/` (gitignored). Polyglot paid run: `eval/runs/2026-10-17T23-33-02/` |

## 7. Gotchas

1. Always pass `--print-logs` to `opencode run`, or it may hang (cause unknown). 3/180 Polyglot runs also exited with `InterruptError` after ~60s; not investigated.
2. Don't `pkill -f 'src/cli.ts serve'` from a shell whose command line contains that string. With the service running, use `systemctl --user`.
3. The service holds port 8787, so a hand-run `bun src/cli.ts serve` will clash with it. The eval is fine: its in-process proxy takes a random port (`port: 0`).
4. Don't remove `dropForeignReasoning`, or Luna → Sol switches fail with HTTP 400.
5. Zen can return HTTP 200 with an in-stream `error` event.
6. OpenCode v2 loads skills from `~/.claude/skills`, so everyday sessions include any skills installed there; the eval isolates HOME.
7. The heuristic's `files=` count picks up paths in pasted tracebacks, so long pasted errors tend to score strong (report 08).
8. Costs in `run --mock` output are fake.

## 8. User preferences

- Short, intuitive explanations; ASCII diagrams when they help.
- Wants things simple and not overfit to the eval.
- Makes the calls on spending, merging and publishing (package is `private`).
- Prefers realistic prompts over ones tuned to the router.
