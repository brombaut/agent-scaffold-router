# Handoff: agent-scaffold-router

**For:** the next agent picking up this repo
**Written:** 2026-10-06, after v1 was merged (commit `8b2a179` on `main`)
**Read first:** this file, then [`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](../CLAUDE.md), then [progress report 05](progress/05_progress_report.md) (an overview of everything so far).

## 1. What this project is

A local HTTP proxy between OpenCode v2 and OpenCode Zen. It routes each **user turn** to a strong model (`gpt-6.1-sol`) or a weak one (`gpt-6-luna`), and logs every request with its cost. v1 (children #1–#4 of the [epic spec](specs/001-epic-agent-scaffold-router.md)) is **done, merged and green in CI**. The next task is **child #5, the evaluation harness**.

## 2. Rules you must follow

- **gstack is required.** Run the check in `CLAUDE.md` before doing any work. It's installed at `~/.claude/skills/gstack` (team mode, auto-updates). Use gstack's `/browse` for web reading.
- **Progress reports.** Write the next numbered file in `docs/progress/` (the next one is `06_progress_report.md`) at real milestones. Never edit past reports except to fix factual errors; a correction note in report 02 is the precedent. The **Decisions and rationale** section is the most important part.
- **Git workflow.** Do feature work on a branch (`feat/NN-…`) and push the branch. **Merge to `main` only when the user says so**; so far they have asked for fast-forward merges. Small docs commits have gone straight to `main` when the user asked for commit-and-push. Commit messages end with the `Co-Authored-By` line from the system prompt.
- **Money.** Live calls spend the user's Zen credit. The user approved a **$1 cap for v1, and $0.51 of it has been spent.** Get a new budget from the user before running the eval (#5), since it will cost more than $1.
- **Secrets.** Never print the Zen key. `opencode auth export` prints secrets; only parse its output in-process (see `src/auth.ts`). Don't `cat` `~/.config/opencode/service.json` or `~/.local/share/opencode/auth.json`.

## 3. Code map

```
src/
  cli.ts                 serve [--port N] [--capture] | report [--since ISO] [--json]
  config.ts              defaults + ~/.config/agent-scaffold-router/config.json (deep-merged)
  auth.ts                key: $OPENCODE_API_KEY, else `opencode auth export` (in-process)
  server.ts              Bun.serve on 127.0.0.1; /v1/responses, /v1/models, /healthz; in-memory maps
  upstream.ts            forward to Zen, tee the SSE stream, log after the stream ends
  sse.ts                 Responses SSE parser: usage (incl. cache_write_tokens), reasoning IDs, errors
  router/policy.ts       route(): virtual models, decision order, fail-open, sanitize
  router/heuristics.ts   message scoring
  router/overrides.ts    !strong / !weak parse + strip (allows a leading quote)
  router/escalation.ts   tool-error streak / repeated identical calls, one-way
  responses/items.ts     session key, turn index, turn start, kind (agent | title | compaction)
  responses/sanitize.ts  drop reasoning items another model produced
  responses/inspect.ts   request-shape summary (only logged with --capture)
  log/decisions.ts       DecisionLogLine, JSONL append, captures
  log/cost.ts            cost incl. cached reads/writes
  report.ts              per-session + total aggregation and table
test/                    54 tests; mock upstream in test/helpers.ts
examples/opencode.jsonc  the working OpenCode v2 provider config
```

The decision order lives in `router/policy.ts`:
1. Unknown model → 400.
2. Forced `strong` / `weak` model → that tier.
3. Title request → `titleTier`.
4. Compaction request → `compactionTier`.
5. `!override` → that tier for the turn.
6. Heuristic score.
7. If the result is weak, check escalation.

Any exception → strong (`router_error`). Then, always: strip override tokens and drop foreign reasoning.

## 4. Environment (this machine)

| Thing | Where / how |
|---|---|
| Bun 1.4.2 | `~/.bun/bin/bun`. **Not on PATH in non-interactive shells**: prefix commands with `export PATH="$HOME/.bun/bin:$PATH"`. |
| OpenCode v2.0.22 | `~/.opencode/bin/opencode`. A v1 backup is at `opencode-1.18.34.bak`. A background `opencode serve --service` is usually running. |
| Zen credential | Stored in OpenCode (integration `opencode`); the proxy reads it itself. `OPENCODE_API_KEY` isn't set. |
| Proxy data | `~/.local/share/agent-scaffold-router/` (`decisions.jsonl`, `captures/`). Child #1's data is in `…/agent-scaffold-router.child1-investigation/`. |
| gbrain | Local PGLite, MCP registered at user scope (see `CLAUDE.md`). Keyword search only; no embedding key is set. |
| gstack `/browse` | Chromium's sandbox is blocked by AppArmor here; run with `GSTACK_CHROMIUM_NO_SANDBOX=1` and Bun on PATH. Only for reading public docs. |

## 5. How to run things

```sh
export PATH="$HOME/.bun/bin:$PATH:$HOME/.opencode/bin"
bun test && bun run typecheck            # what CI runs
bun src/cli.ts serve --capture           # dev proxy (captures contain code and prompts)
bun src/cli.ts report --since 2026-10-06
```

**Live OpenCode testing** that worked:
1. Make a throwaway project directory containing `examples/opencode.jsonc` as `opencode.jsonc`.
2. Run:
   ```sh
   ASR_CLIENT_KEY=unused opencode run --standalone --auto --format json \
     --print-logs --log-level error -m router/auto "your prompt" > out.jsonl 2> err.log
   ```
3. Continue the same session with `-s <sessionID>`; the session ID is in the first JSON line of `out.jsonl`.

## 6. Gotchas that cost time before

1. **Always pass `--print-logs`** to `opencode run`. Without it, runs sometimes hang before sending any request; this has a known workaround but no known cause. Hangs often followed edits to `opencode.jsonc`.
2. **Don't kill the proxy with `pkill -f 'src/cli.ts serve'`** (or an `awk` match on that text) from a shell whose own command line contains the same string, because it kills your own shell (exit 144). Use a PID file.
3. **Replays must include OpenCode's headers.** Zen behaves differently when `x-session-affinity` / `x-session-id` / `x-opencode-session*` are present. Report 02 drew a wrong conclusion from a replay without them. `serve --capture` now saves `<id>.headers.json` (credentials removed) for faithful replays.
4. **`opencode run` wraps prompts in literal quotes** (`"\"…\""`). Anything that parses user text must allow for that.
5. **With virtual model names**, OpenCode keeps earlier turns' reasoning items and IDs; with real model names it strips them on a switch. Don't remove `dropForeignReasoning`, or Luna → Sol switches return HTTP 400 `{"model":"gpt-6.1-sol"}`.
6. **Zen can return HTTP 200 with an in-stream `error` event** (capacity limits). OpenCode retries, and the retry may miss the cache.
7. **OpenCode v2 loads skills from `~/.claude/skills`**, so gstack shows up inside OpenCode sessions and inflates token counts. Take this into account in the eval, or isolate HOME.
8. **The v2 docs are ahead of the 2.0.22 binary.** Check package names with `strings ~/.opencode/bin/opencode | grep providers/`.

## 7. Next task: child #5, the evaluation harness

From the spec: run auto vs strong vs weak with headless `opencode run` on a task set, comparing tasks solved, cost per solved task and latency. Suggested shape (not yet agreed with the user; confirm before building):

- **Task set:** small repos with a verifiable check (tests that fail before and pass after), a mix of easy edits and harder debugging. Report 00 mentions SWE-bench subsets and the SWE-Router trajectory dataset as options.
- **Runner:** for each task × each model (`router/auto`, `router/strong`, `router/weak`):
  1. copy the repo fresh;
  2. run `opencode run` with `--print-logs`;
  3. run the check;
  4. join the outcome with `decisions.jsonl` by session ID.
- **Metrics:** solve rate, cost per solved task, % strong, cache-read ratio, escalations, wall time.
- **Use the data to settle the open questions:**
  - escalation false positives (e.g. count only shell/test tool errors);
  - which tier compaction should use;
  - how far the all-strong counterfactual is from a real strong run.
- **Budget:** ask first. A full matrix will cost several dollars.

## 8. Open questions (also in report 05)

- Root cause of the OpenCode `run` hang.
- Escalation counts reads of source files that mention "error" as failures.
- Compaction defaults to strong without evidence.
- The all-strong counterfactual is approximate.
- Later work: an LLM-judge router (#6), `/chat/completions` and per-task model specialization (#7), an OpenCode plugin (#8). Claude Code support (#9) is blocked on auth.

## 9. User preferences observed

- Wants explanations short, and ASCII diagrams when they help.
- Makes the calls on merging, licensing (none for now) and publishing (not yet; the package is `private`).
- Wants progress reports kept current, and asked for an overview note (report 05) after a break.
