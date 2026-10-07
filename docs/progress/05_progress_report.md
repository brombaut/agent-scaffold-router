# 05 — Where we are: overview of reports 00–04

**Date:** 2026-10-06
**Phase:** Recap after v1; no new work since [report 04](04_progress_report.md)
**Purpose:** A short refresher on the whole project so far, with a one-paragraph summary of each earlier report.

## The project in one line

**agent-scaffold-router** is a local proxy that sits between OpenCode and the model provider. For each turn of a conversation, it decides whether the work needs the expensive model or the cheap one, then logs what that choice cost.

```
                          ┌───────────────────────────────┐
  you ──▶ OpenCode ──────▶│  agent-scaffold-router        │──────▶ OpenCode Zen
          (router/auto)   │  127.0.0.1:8787               │        /responses
                          │                               │
                          │  1. which session / turn?     │   ┌─ gpt-6.1-sol  (strong)
                          │  2. strong or weak?           │───┤   $2 / $10 per 1M
                          │  3. rewrite model, clean body │   └─ gpt-6-luna   (weak)
                          │  4. stream reply back         │       $0.10 / $0.50 per 1M
                          │  5. log cost ─▶ decisions.jsonl
                          └───────────────────────────────┘
                                         │
                                         ▼
                              `report` → savings per session
```

Goals ([spec](../specs/001-epic-agent-scaffold-router.md)):
1. Cut the cost of daily OpenCode use without a noticeable quality drop.
2. Collect data for a blog post.
3. Eventually release it as an open-source tool.

## Timeline

```
 research ──▶ spec ──▶ #1 proxy ──▶ #2 routing ──▶ #3 log/report ──▶ #4 package/CI ──▶ #5 eval ──▶ …
 report 00   report 01  report 02    └──────── report 03 ────────┘    report 04        ▲
    ✓          ✓          ✓                     ✓                         ✓        WE ARE HERE
                                                                                (v1 done, on main)
```

## The earlier reports in brief

- **[00 — Initial research](00_progress_report.md).** We surveyed LLM routing, with a focus on coding agents.
  - Single-turn results like RouteLLM don't carry over to agents, because a message judged alone loses the session's context.
  - Prompt caching dominates the cost math, since each switch means paying to cache the context on the new model.
  - Starting cheap and escalating on evidence beats predicting difficulty up front.
  - Tentative choice: an HTTP proxy rather than an OpenCode plugin.

- **[01 — v1 epic spec](01_progress_report.md).** The epic is in [`docs/specs/001`](../specs/001-epic-agent-scaffold-router.md).
  - Upstream: OpenCode Zen, with `gpt-6.1-sol` as strong and `gpt-6-luna` as weak. Both use the same Responses API, and the price gap is 20x.
  - Stack: TypeScript on Bun.
  - Routing: per turn, cheap first, one-way escalation, fail-open to strong, `!strong` / `!weak` overrides, and a JSONL decision log.
  - Plan: 9 child issues, with v1 being #1–#4. Claude Code support (#9) is blocked because Pro subscription access can't be used in third-party tools.

- **[02 — Passthrough proxy and investigation](02_progress_report.md).**
  - Upgraded OpenCode from 1.18 to v2.0.22, because the spec had assumed v2.
  - Built the passthrough proxy and answered the five investigation questions:
    - OpenCode sends the full history every time (no server-side state).
    - It uses its session ID as the prompt-cache key.
    - Title and compaction requests are easy to tell apart from normal turns.
    - The key reaches both models.
  - Its conclusion that switching models mid-turn was safe was **wrong**; report 03 corrects it.

- **[03 — Routing core, decision log, cost and `report`](03_progress_report.md).** Built the routing heuristics, overrides, escalation, cost accounting (including cache writes) and the `report` command.
  - Found the main surprise of the project: with OpenCode's session headers present, Zen rejects one model's encrypted reasoning when it's sent to the other model.
  - Fix: the proxy tracks which model produced each reasoning item and drops the other model's items before forwarding.
  - The live 3-turn session saved 32%.

- **[04 — Packaging, README, CI; v1 merged](04_progress_report.md).**
  - Added package metadata, a README and GitHub Actions CI.
  - Merged everything into `main`.
  - Per your decisions: no license and no npm publish yet, and the package is marked `private`.

## How a routing decision is made

```
 new user message arrives
          │
          ▼
  starts with !strong / !weak? ──yes──▶ use that tier for the whole turn
          │ no
          ▼
  title request? ──▶ weak        compaction (summary) request? ──▶ strong
          │ neither
          ▼
  score the message
    +2  "debug", "why", "design", "refactor", "race", …   (max 2 counted)
    +2  longer than 2,000 characters
    +1  3+ file paths      +1  code block over 50 lines
    −1  "rename", "typo", "lint", "commit", "show me", …   (max 2 counted)
          │
     score ≥ 3 ? ── yes ──▶ STRONG (Sol)
          │ no
          ▼
        WEAK (Luna) ──── during the turn: 3 tool errors in a row,
                         or the same tool call 3 times? ──▶ escalate to STRONG
                         (one-way: never drops back within the turn)

  any router crash ──▶ STRONG   (a bug should cost money, not quality)
```

The tier holds for the whole turn so the provider's prompt cache keeps paying off. Switching models means writing roughly 18K tokens of context into the new model's cache, about $0.045 on Sol.

## Key lessons

1. **One model rejects the other's encrypted reasoning** ([report 03](03_progress_report.md)):
   ```
   turn 1 (Luna)  ──▶ produces encrypted reasoning  rs_abc
   turn 2 (Sol)   ──▶ history still contains rs_abc ──▶ Zen: HTTP 400 ✗
   ```
   This only happens when OpenCode's session headers are present, which is why report 02's test, sent without them, missed it. The proxy now drops the other model's reasoning items and keeps each model's own, so caches stay warm.
2. **Check claims against the real binary and real traffic, not the docs or a hand-made replay.**
   - The OpenCode v2 docs list a package the binary doesn't include.
   - `opencode run` wraps prompts in quotes.
   - The spec's error pattern missed `TypeError`.
   - Zen can fail inside an HTTP 200 stream.

## Live proof (from [report 03](03_progress_report.md))

```
 turn  message                                   tier     cost
 ────  ────────────────────────────────────────  ───────  ───────
  1    "Show me what math.ts does"               Luna     $0.003
  2    "Debug why average returns NaN, fix it"   Sol      $0.191   ← heuristic: debug + why
  3    "!weak confirm it's fixed"                Luna     $0.002   ← override
 ────────────────────────────────────────────────────────────────
       routed: $0.197    all-Sol estimate: $0.289    saved: 32%
```

Sol fixed the bug correctly. Most of turn 2's cost came from one retry after a Zen capacity error, which missed the cache. Live spend for all of v1: $0.51.

## Open questions

| Issue | Why it matters |
|---|---|
| OpenCode `run` sometimes hangs before sending anything | The cause isn't found yet; `--print-logs` has avoided it every time |
| Escalation may fire falsely | Reading 3 files that contain the word "error" looks like 3 failures |
| Compaction defaults to Sol | Reasonable guess, not measured |
| The "all-Sol" comparison is an estimate | It reprices the same tokens; a real all-Sol session would play out differently |

## Next step: child #5, the evaluation harness

```
   task set ──▶ opencode run (headless) ──┬──▶ router/auto
                                          ├──▶ router/strong   (all-Sol baseline)
                                          └──▶ router/weak     (all-Luna baseline)
                                                   │
                                   compare: tasks solved, cost per solved task, latency
```

The evaluation answers the real question: does `auto` keep Sol-level quality at a fraction of the cost? It will also give us data to tune the open questions above. After it come the LLM-judge router (#6) and task-specialized model routing (#7).
