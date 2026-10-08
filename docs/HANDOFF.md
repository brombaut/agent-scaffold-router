# Handoff: agent-scaffold-router

**For:** the next agent picking up this repo
**Written:** 2026-10-07. It replaces the 2026-10-06 version, which was written right after v1.
**Read first:** this file, then [`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](../CLAUDE.md), then [progress report 05](progress/05_progress_report.md), an overview of reports 00–04.

## 1. Where we are, in one paragraph

This repo is a local HTTP proxy between OpenCode v2 and OpenCode Zen. For each **user turn**, it routes the request to a strong model (`gpt-6.1-sol`) or a weak one (`gpt-6-luna`), and it logs every request with its cost.

- **v1 (children #1–#4 of the [epic spec](specs/001-epic-agent-scaffold-router.md)):** done and merged to `main`.
- **Child #5, the evaluation harness:** built, but it has **not been run against Zen yet**. It's on branch `feat/05-eval-harness`, commit `2b4cfa9`, pushed with CI green, and not merged.
- **Next step:** a small paid pilot run, but only when the user says go.

```
 #1 proxy ─ #2 routing ─ #3 log/report ─ #4 package/CI ─ #5 eval harness ─ #5 live runs ─ #6 LLM judge …
    ✓           ✓             ✓               ✓            built, on branch    ▲ NEXT (needs user's go)
                         (all on main)                     not merged
```

## 2. Rules you must follow

- **gstack is required.** Run the check in `CLAUDE.md` before doing any work. It's installed at `~/.claude/skills/gstack` (v1.91.34.0, team mode, auto-updates). Use gstack's `/browse` for web reading.
- **Progress reports.** Write the next numbered file in `docs/progress/`; the next one is `06_progress_report.md`. Do this at real milestones. The eval harness plus its first live results is a natural point for report 06. Never edit past reports except to fix factual errors. **Decisions and rationale** is the most important section.
- **Git workflow.**
  - Do feature work on a branch (`feat/NN-…`) and push it.
  - **Merge to `main` only when the user says so.** So far they've asked for fast-forward merges.
  - Commit or push only when asked.
  - Commit messages end with the `Co-Authored-By` line from the system prompt.
- **Money: no live runs without the user's explicit go-ahead.**
  - The user approved a **$5 budget for the eval** (2026-10-07), but said **"don't run anything yet."**
  - Nothing has been spent on the eval so far. v1 testing spent $0.51 earlier.
  - Live runs must use `--budget` ≤ the approved amount.
- **Secrets.**
  - Never print the Zen key.
  - `opencode auth export` prints secrets; only parse its output in-process (see `src/auth.ts`).
  - Don't `cat` `~/.config/opencode/service.json` or `~/.local/share/opencode/auth.json`.

## 3. What happened on 2026-10-07

1. **Environment fixes.**
   - gstack's auto-update was failing because Bun wasn't on PATH in non-interactive shells. The Bun lines in `~/.bashrc` are now **above** the "not interactive → return" check, and the original is at `~/.bashrc.bak-2026-10-07`.
   - Bun is now on PATH in every shell, including Claude Code's.
   - gstack was upgraded to 1.91.34.0.
2. **Logging review.** The user asked whether the proxy logs everything. It already logs every forwarded request to `decisions.jsonl` (plus full bodies with `--capture`), which is what they wanted.
   - Not logged: rejected requests (400/404), router stack traces (stderr only), and requests in flight when the proxy dies.
   - **The user decided not to fix these.** Don't add an events log unless asked.
3. **Eval harness design agreed with the user:**
   - **Task set:** option (a), our own small TypeScript tasks, not a SWE-bench subset. SWE-bench can be added later if the blog post needs credibility.
   - **Budget:** $5, gated as above.
   - **Prompts:** keep them as written (see §5).
4. **Built and committed the harness** (`2b4cfa9`). The details are in §4.

## 4. The eval harness (`eval/`)

```
for each rep × task × config (config order rotates per task):
  copy eval/tasks/<id>/repo → fresh git workspace in $TMPDIR
  opencode run --standalone --auto --format json --print-logs -m router/<config> "<prompt>"
      HOME/XDG → temp dir; only config is examples/opencode.jsonc pointed at an in-process proxy
  git diff → diff.patch; restore protected test/ dir; bun test → solved?
  log lines that arrived during the run → result (cost, tokens, % strong, start tier, escalation)
→ eval/runs/<stamp>/{results.jsonl, summary.md, decisions.jsonl, <task>/<config>-r<rep>/…}
```

| File | Purpose |
|---|---|
| `eval/run.ts` | CLI: `list`, `self-check`, `run (--mock \| --live --budget USD)`, `summarize <dir>` |
| `eval/mock.ts` | Fake Zen `/responses` that replies with text only. Used by `run --mock` (free) |
| `eval/tasks/<id>/` | `task.json` (difficulty, prompt), `repo/` (failing), `solution/` (reference fix, self-check only) |
| `eval/README.md` | How to run it, and the design notes |
| `bunfig.toml` | `[test] root = "test"`, so the repo's own `bun test` ignores the task repos (otherwise 32 failures in CI) |

**Safeguards:**
- **Budget guard:** once logged spend ≥ `--budget`, the proxy returns HTTP 402 instead of calling Zen, and the current OpenCode run is killed.
- **Workspace isolation:** workspaces are outside the repo, so OpenCode doesn't pick up this project's `AGENTS.md`.
- **Prompt isolation:** an isolated HOME keeps gstack skills out of the prompt. This was verified: the agent request is about 21 KB with no gstack content.
- **Separate log:** the eval writes to its own `decisions.jsonl`, not the everyday one.
- **No test tampering:** `test/` is restored before the check, so editing tests doesn't count as a solve.

**Verified at no cost:**
- `self-check`: all 12 tasks fail as given and pass with their solution.
- `run --mock` worked end to end on 2 tasks × 3 configs, and OpenCode's `sessionID` matched the proxy's `sessionKey`.
- The 54 unit tests and the typecheck pass.

## 5. Tasks and what the heuristic does with them

| Task | Difficulty | Heuristic tier at turn start |
|---|---|---|
| greeting-typo, rename-function, add-clamp, range-off-by-one, slugify, config-default | easy | weak |
| lru-cache, csv-parser, token-bucket | hard | weak (no keywords) |
| async-fetch-all ("investigate"), deep-merge ("security") | hard | weak (score 2 < 3) |
| emitter-once ("why", "root cause") | hard | **strong** (score 4) |

**`auto` starts 11 of 12 tasks on the weak model**, so this eval mainly tests whether **escalation** rescues the weak model on hard tasks. The user chose to keep the prompts realistic rather than tune them for the heuristic. Watch for:
- hard tasks the weak model fails without escalating (heuristic and escalation misses);
- escalations on tasks the weak model would have solved anyway (false positives).

## 6. Next steps

1. **Wait for the user's go.** Then run a **pilot** of about 2 tasks × 3 configs, roughly $0.30:
   ```sh
   export PATH="$HOME/.bun/bin:$PATH:$HOME/.opencode/bin"
   bun eval/run.ts run --live --budget 1 --tasks greeting-typo,lru-cache
   ```
   Check the real cost per run, the wall times, and that nothing hangs. Then propose the full run.
2. **Full run**, at most $5. My rough guess was strong about $1–1.50, auto about $0.30 and weak about $0.10 per pass of 12 tasks, so about 2 passes (`--reps 2`). Re-estimate from the pilot.
3. **Write progress report 06**: the harness design and decisions (from §3–5) plus the results.
4. **Use the results** to settle the open questions in §8, and decide with the user whether to merge `feat/05-eval-harness`.

## 7. Environment (this machine)

| Thing | Where / how |
|---|---|
| Bun 1.4.2 | `~/.bun/bin/bun`, now on PATH in all shells (fixed 2026-10-07). |
| OpenCode v2.0.22 | `~/.opencode/bin/opencode`. Add `~/.opencode/bin` to PATH for the eval. A v1 backup is at `opencode-1.18.34.bak`. |
| Zen credential | Stored in OpenCode (integration `opencode`); the proxy reads it itself. `OPENCODE_API_KEY` isn't set. |
| Proxy data | `~/.local/share/agent-scaffold-router/` (`decisions.jsonl`, 48 lines; `captures/`, 14 MB). Eval output goes to `eval/runs/` (gitignored) instead. |
| gbrain | Local PGLite MCP server; it disconnects sometimes. Fall back to grep. |
| gstack `/browse` | Chromium's sandbox is blocked by AppArmor here; run with `GSTACK_CHROMIUM_NO_SANDBOX=1`. Only for reading public docs. |

Commands CI runs: `bun test && bun run typecheck`. Dev proxy: `bun src/cli.ts serve [--capture]`. Report: `bun src/cli.ts report [--since ISO]`.

## 8. Gotchas

1. **Always pass `--print-logs`** to `opencode run`; without it, runs sometimes hang (cause unknown). The eval runner already does.
2. **Don't kill the proxy with `pkill -f 'src/cli.ts serve'`** from a shell whose own command line contains that string; it kills your shell. The eval runs the proxy in-process, so this doesn't apply there.
3. **Replays must include OpenCode's headers** (`x-session-affinity`, `x-session-id`, `x-opencode-session*`); Zen behaves differently without them. `--capture` saves them.
4. **`opencode run` wraps prompts in literal quotes.** The proxy's override parser allows for it.
5. **Don't remove `dropForeignReasoning`**, or Luna → Sol switches fail with HTTP 400.
6. **Zen can return HTTP 200 with an in-stream `error` event.** OpenCode retries, and the retry may miss the cache. These show up as `req errors` in the eval summary.
7. **OpenCode v2 loads skills from `~/.claude/skills`.** The eval avoids this with an isolated HOME; everyday sessions still include gstack.
8. **The v2 docs are ahead of the 2.0.22 binary.** Check with `strings ~/.opencode/bin/opencode | grep providers/`.
9. **Costs in `run --mock` output are fake**, priced from the mock's made-up token counts. Ignore them.

## 9. Open questions

- Root cause of the `opencode run` hang.
- Escalation counts reads of source files that mention "error" as tool failures. The eval should show how often this happens.
- Compaction defaults to the strong model without evidence. These tasks are probably too short to trigger compaction.
- How far the all-strong counterfactual is from a real `router/strong` run. The eval has both, so compare them.
- Later: an LLM-judge router (#6), `/chat/completions` and per-task specialization (#7), an OpenCode plugin (#8). Claude Code support (#9) is blocked on auth.

## 10. User preferences observed

- Wants explanations short, with ASCII diagrams when they help.
- Makes the calls on merging, spending, licensing (none for now) and publishing (not yet; the package is `private`).
- Wants the logging as it is, without extra hardening.
- Prefers realistic task prompts over ones tuned to the router.
