# 03 — Children #2 and #3: routing core, decision log, cost and `report`

**Date:** 2026-10-03
**Phase:** v1 routing working end to end in OpenCode
**Previous:** [02 — Passthrough proxy and investigation](02_progress_report.md)
**Branch:** `feat/02-routing-core` (stacked on `feat/01-passthrough-proxy`)

## What we did

**Routing core (child #2).** Implements the spec's design:
- `src/router/policy.ts`: virtual models `auto` / `strong` / `weak`; 400 for any other model; fail-open to strong (`router_error`).
- `src/responses/items.ts`: session key (`prompt_cache_key`, then `previous_response_id`, then a hash), turn index, turn start vs continuation, and request kind (`agent` / `title` / `compaction`).
- `src/router/heuristics.ts`: scoring per the spec table.
- `src/router/overrides.ts`: `!strong` / `!weak`, stripped from every user message.
- `src/router/escalation.ts`: consecutive tool errors or repeated identical calls.
- `granularity: "session"` is supported.
- Routing is **stateless**: each request's tier is a pure function of its input items and the config, so a proxy restart doesn't change decisions. Escalation scans the whole current turn, so once it fires it stays fired, which makes it one-way without any stored state.

**Decision log, cost and `report` (child #3):**
- `src/log/decisions.ts`: the spec's `DecisionLogLine`, plus `kind`, `droppedReasoning` and `error`.
- `src/log/cost.ts`: cost including cache reads and cache writes, plus the all-strong counterfactual.
- `src/report.ts` and `agent-scaffold-router report [--since ISO] [--json]`: per session and in total, it shows requests, turns, % strong, cache-read ratio, cost, all-strong cost, savings, a breakdown of decision reasons, and errors.

**History sanitizing.** `src/responses/sanitize.ts` drops reasoning items that another model produced. `src/sse.ts` records which model emitted each `rs_` ID. See Issue 1.

**Tests.** 54 tests (`bun test`, `tsc --noEmit` clean). They cover each heuristic signal, the caps and the threshold boundary; override parsing and stripping (including quoted prompts); escalation, including that it's one-way and doesn't fire on `0 errors`; turn and session detection; cost math; report aggregation; and integration tests through the proxy for acceptance criteria 4, 5 and 6, the 400 for unknown models, prefix stability, and reasoning ownership across models.

**Live end-to-end run.** A 3-turn OpenCode session on `router/auto`, plus acceptance criterion 2 (see Results). [`examples/opencode.jsonc`](../../examples/opencode.jsonc) now uses the virtual models.

## Issues encountered

1. **Report 02 was wrong about mid-turn switching** (a correction note was added there). The first live `auto` session failed on turn 2 with HTTP 400 and the body `{"model":"gpt-6.1-sol"}`. Bisecting with captured requests, each replayed through the proxy:

   | Variant | Result |
   |---|---|
   | Failing request without OpenCode's headers | 200 |
   | With all OpenCode headers | 400 |
   | Headers, minus `x-session-affinity` / `x-session-id` / `x-opencode-session*` one group at a time | 400 |
   | Headers, minus all four session headers | 200 |
   | Headers, Luna reasoning items removed (message IDs kept) | 200 |
   | Mid-turn Luna request to Sol, with headers | 400 |
   | Same, reasoning removed, `fc_` calls kept | 200 |

   **Conclusion:** when a session header is present, Zen rejects encrypted reasoning that another model produced. Report 02's replay passed only because it was sent without those headers.

   Report 02 also missed a second effect. With a single virtual model name, OpenCode **keeps earlier turns' reasoning items and IDs** in the history. With real model names it stripped them on every switch, which is why the switches in report 02 looked clean.
2. **`opencode run` wraps the prompt in literal double quotes** (`"\"!weak …\""`). The override regex missed it, while keyword scoring wasn't affected. Fixed by allowing an optional leading `"`.
3. **The spec's error regex misses exception names.** `\berror\b` doesn't match `TypeError:`. Widened to `(error|exception)\b|\b(traceback|failed|exit code [1-9])\b`; `0 errors` still doesn't match.
4. **OpenCode v2 runs sometimes hang** before sending any request (also seen in report 02). Every scripted run with `--print-logs` succeeded; several without it hung. Unproven hypothesis: contention with the background `opencode serve --service` (shared log file or SQLite). The proxy isn't involved, since no request reached it.
5. **Zen can fail inside an HTTP 200 stream:** `"The system is currently experiencing high demand… exceeds the maximum usage size allowed during peak load"`. OpenCode retried, and the retry missed Sol's cache: 32K tokens written, $0.08, about 40% of the session's cost. `report` now counts stream errors as errors, not only status ≥400.
6. **OpenCode v2 loads skills from `~/.claude/skills`**, so the gstack skills showed up in the sandbox and Sol read several of them while fixing a one-character bug. That inflated the turn-2 cost.
7. **A first attempt at the fix was wrong.** Stripping `id` from message items appeared to work, but only in replays without headers. Reverted.

## Decisions and rationale

| Decision | Alternatives considered | Why |
|---|---|---|
| **Drop reasoning items another model produced.** Ownership is recorded per `rs_` ID from response streams; items with an unknown owner (e.g. after a restart) are dropped. | (a) Strip OpenCode's session headers. (b) Always drop all reasoning. (c) Switch to `granularity: "session"` (rule 9). | (a) The headers probably drive Zen's backend affinity and so its cache hits; removing them trades a known error for an unknown cost. (b) Would throw away each model's own reasoning and its cached prefix. (c) Isn't needed, because the fix is about 40 lines of code across `sanitize.ts`, `sse.ts`, `upstream.ts` and `server.ts` (rule 9 allows under 50). Keeping each model's own reasoning keeps its prefix stable: on the live run, Luna's turn 3 read exactly its cached turn-1 prefix (18,650 tokens). |
| **Unknown owner → drop** | Unknown → keep | Losing some reasoning once after a restart is better than a request rejected in front of the user. |
| **Compaction → strong by default** (`policy.compactionTier`) | Weak, or the session's tier | Report 02: compaction re-reads the whole context uncached, but a bad summary hurts every later turn. Will be measured in #5. |
| **Title → weak** (`policy.titleTier`; the example config also pins the title agent to `router/weak`) | Route titles like a turn | Titles are tiny, and quality barely matters. |
| **Routing stays stateless; only reasoning ownership is in memory** | Track per-session state | A restart doesn't change routing decisions; it only drops some reasoning once. |
| **Log `kind`, `droppedReasoning` and `error`** | Keep only the spec's fields | Needed to diagnose the issues above and to separate title and compaction cost in #5. |

## Results

**Acceptance criteria (v1 = #1–#4):**

| # | Criterion | Status |
|---|---|---|
| 1 | `serve` on 127.0.0.1:8787, `/healthz` 200 | ✓ via `bun src/cli.ts serve`; `bunx` needs packaging (#4) |
| 2 | `opencode run -m router/auto "say hi"` → 1 log line, all fields set | ✓ live (with `--title`; an untitled run adds a second line for the title request) |
| 3 | Streamed response byte-identical | ✓ mock-upstream test |
| 4 | One tier per turn unless escalating; never strong → weak | ✓ integration test + live session |
| 5 | `!strong` forces the turn and never reaches the upstream | ✓ integration test (live `!weak` turn too) |
| 6 | Classifier exception → strong, request succeeds | ✓ integration test |
| 7 | Upstream 4xx/5xx passed through unchanged | ✓ test |
| 8 | `report` per session and total | ✓ |
| 9 | Child #1 answers recorded | ✓ report 02, corrected here |
| 10 | `bun test` in CI | pending (#4) |

**Live 3-turn session** (`ses_f0021d6b…`, `router/auto`, buggy `math.ts`):

| Turn | Prompt | Tier (reason) | Requests | Cost |
|---|---|---|---|---|
| 1 | "Show me what math.ts does, briefly." | weak (`heuristic:score=-1[weak:show me]`), plus the title request (weak) | 5 | $0.003 |
| 2 | "Debug why average returns NaN and fix it…" | strong (`heuristic:score=4[keyword:debug,keyword:why]`), 2 Luna reasoning items dropped per request | 9 | $0.191 |
| 3 | "!weak Read math.ts and confirm…" | weak (`override:!weak`), 4 Sol reasoning items dropped | 2 | $0.002 |

`report` for the session: 16 requests, 56% strong, 74% cache-read ratio, **$0.197 actual vs $0.289 all-strong (32% saved)**. Sol fixed the bug correctly. Cache reads grew on every request within a turn, apart from the retry after Zen's capacity error (Issue 5).

**Spend:** $0.35 this phase (39 billed requests, including bisecting), **$0.51 total** against your $1 cap.

## Open questions / next steps

1. **Escalation false positives.** Reading three source files that mention "error" counts as three tool errors. We need real-session data from #5 before tuning it, e.g. only counting errors from shell or test tools.
2. **Compaction tier.** Strong is the default for now; measure it in #5.
3. **Root-cause the OpenCode hang** before the README tells people to use `opencode run`.
4. **The counterfactual is approximate.** All-strong cost reprices the same tokens; a real all-Sol session would have different cache behavior and turn counts. The #5 eval should run real `strong` baselines.
5. **Next: child #4.** Packaging (`bunx agent-scaffold-router`), README (setup, how routing works, overrides, the reasoning-ownership note, the hang workaround), and a GitHub Actions `bun test` workflow. Then merge both branches and start #5.
