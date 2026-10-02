# 01 — v1 epic spec

**Date:** 2026-10-02
**Phase:** Spec (via gstack `/spec`), before any code
**Previous:** [00 — Initial research](00_progress_report.md)

## What we did

- Ran `/spec` to turn the research in report 00 into an epic:
  [`docs/specs/001-epic-agent-scaffold-router.md`](../specs/001-epic-agent-scaffold-router.md).
- Added the GitHub remote `brombaut/agent-scaffold-router` (private).
- Checked which models are actually reachable: inspected OpenCode's local config
  and credentials (without reading secrets), listed Zen models from
  `GET https://opencode.ai/zen/v1/models`, and read Zen's endpoint and pricing docs.

## Goals (as stated by the user)

1. Cut the cost of daily OpenCode use without a noticeable quality drop (primary).
2. Benchmark it for a blog post (light rigor, not academic).
3. Release as a reusable open-source tool.

No deadline. v1 bar: it runs live in daily OpenCode use and logs decisions;
evaluation comes after.

## Issues encountered

- **Claude Pro can't be used.** The user's only Anthropic access is a Pro
  subscription, and Anthropic has blocked subscription OAuth in third-party
  harnesses (OpenCode included) since 2026-04-04
  ([falcao.org](https://falcao.org/posts/anthropic-claude-access-crackdown-ecosystem-fallout/)).
  It also makes routing Pro traffic through our proxy in a future Claude Code
  phase a gray area. That child issue (#9) is marked blocked.
- **I made a wrong claim, now corrected.** Based on a search summary, I said
  every Zen model was available on the OpenAI-compatible `/chat/completions`
  endpoint. [Zen's docs](https://opencode.ai/docs/zen) say GPT models are served
  **only** on `/zen/v1/responses` (the Responses API), and the two are "not
  interchangeable." Lesson: verify API shape claims against primary docs before
  designing around them.
- **"Zen vs Console" naming.** OpenCode Console is the key/billing dashboard;
  Zen (pay-as-you-go) and Go (subscription) are the model catalogs behind one
  `OPENCODE_API_KEY`. Still unknown: which plan the user's key is on, and whether
  Go includes the GPT models. Child #1 checks this.

## Decisions and rationale

| Decision | Alternatives considered | Why |
|---|---|---|
| **Upstream = OpenCode Zen** | Anthropic API, OpenRouter, local Ollama | It's what the user already has a key for. Anthropic is out (Pro OAuth blocked, cost). Local tier rejected by the user. |
| **Tiers: `gpt-6.1-sol` strong / `gpt-6-luna` weak** | Kimi K3, GLM 5.3, DeepSeek V4 Pro as strong | The user picked Luna as weak. Sol is on the same `/responses` endpoint and model family, so there's no request translation and tool-call formats are identical. A 20x price gap ($2/$10 vs $0.10/$0.50 per 1M) makes savings visible. Kimi/GLM etc. are on `/chat/completions`, which would need translation. |
| **The proxy speaks the OpenAI Responses API** | `/chat/completions`, Anthropic Messages | Forced by the tier choice. `/chat/completions` and per-task model specialization are planned as child #7; the user is interested in "routing to the model that's best at each task." |
| **TypeScript on Bun** | Python | Same ecosystem as OpenCode plugins (the optional plugin can share code), natural `bunx` distribution for OpenCode users, native streaming. Python's ML/LiteLLM advantages matter less with a heuristics-only v1. |
| **Per-turn routing, cheap-first, one-way escalation** | Per request, per session | Report 00: per-request routing breaks caching and context; cheap-first with escalation on evidence (SWE-Router, Unblocked cascade results) beats predicting difficulty up front. A `granularity: "session"` knob is kept as an experiment axis and fallback. |
| **Virtual models `auto` / `strong` / `weak`** | Only `auto` | Forced tiers give eval baselines through the same logging path. |
| **Fail-open to strong** | Fail to weak, fail closed | A router bug should cost money, not quality. |
| **`!strong` / `!weak` overrides, stripped from all user messages** | Strip only the latest message | Stripping only the latest message would change history on the next turn and break prompt-cache prefix matching. |
| **JSONL decision log + `report` CLI** | SQLite, dashboard | Simplest thing that supports cost-per-session and counterfactual all-strong cost for the blog. |
| **Epic with 9 children; v1 = #1–#4** | One spec per milestone | User asked for the epic now. |

## Key open risk

The Responses API can carry server-side state (`previous_response_id`, stored or
encrypted reasoning items). If OpenCode's requests reference Sol's reasoning
items and we then route to Luna, the provider may reject the request. Child #1
captures real request bodies and tests a mid-session switch **before** the
router is built. Decision rule 9 in the spec: if it breaks and can't be fixed in
under 50 lines, the default granularity becomes `"session"`.

## Results

None yet (no code).

## Next steps

1. Child #1: passthrough proxy + request capture + answers to the 5 investigation
   questions, recorded in the next progress report.
2. Then #2 (routing core) and #3 (logging/report) in parallel, then #4 (packaging).
