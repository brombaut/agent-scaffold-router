# Epic: Agent Scaffold Router v1 (OpenCode, Responses API, strong/weak routing)

> **Status:** DRAFT (Phase 4 of `/spec`). Not yet filed.
> **Verified:** 2026-10-02. Research background: `docs/progress/00_progress_report.md`.

## Context

OpenCode sends every model request to the one model the user picked by hand. Most
turns in a coding session (rename this, run the tests, commit) don't need a
frontier-priced model, but some (design this, debug this race) do. We want a local
router that sits between OpenCode and the model provider and decides per user turn
whether to use a **strong** or a **weak** model, logging every decision with its
cost so savings can be measured.

Goals, in priority order:
1. Cut the cost of daily OpenCode use without a noticeable quality drop (primary).
2. Produce enough data for a blog post benchmarking router vs fixed models (light rigor).
3. Ship as a reusable open-source tool (`bunx agent-scaffold-router`).

No deadline; open-ended exploration. v1 bar: **it runs live in daily OpenCode use
and logs decisions.** Evaluation is a follow-on child issue.

## Current State (verified 2026-10-02)

| Fact | Evidence |
|---|---|
| Repo is greenfield: only `AGENTS.md`, `CLAUDE.md`, `docs/progress/00_progress_report.md` | `git ls-files` |
| OpenCode **v2.0.14** installed | `opencode --version` |
| OpenCode has one credential, integration `opencode` (Zen/Go key) | `~/.local/share/opencode/opencode.db`, `credential` table |
| Default model is local `ollama/qwen3.5:9b@q3_k` (not used by this epic) | `~/.config/opencode/config.json` |
| Zen API live: `GET https://opencode.ai/zen/v1/models` → 200, `POST /zen/v1/responses` without key → 401 | curl probe |
| GPT models on Zen are served **only** on `/zen/v1/responses`; Kimi/GLM/DeepSeek/MiniMax/Qwen only on `/zen/v1/chat/completions`. "Not interchangeable." | [Zen docs](https://opencode.ai/docs/zen) |
| Claude Pro subscription OAuth is blocked in third-party harnesses (incl. OpenCode) since 2026-04-04 | [falcao.org](https://falcao.org/posts/anthropic-claude-access-crackdown-ecosystem-fallout/), [pasqualepillitteri.it](https://pasqualepillitteri.it/en/news/642/anthropic-blocks-openclaw-third-party-tools-claude-subscriptions) |
| OpenCode v2 plugins cannot switch a session's model; `http.request` hook can rewrite body | [v2 migration guide](https://opencode.ai/v2/docs/build/plugins/migrate-v1) (unverified against source) |

"OpenCode Console" is the dashboard where the API key and billing live; **Zen**
(pay-as-you-go) and **Go** (subscription) are the model catalogs behind the same
`OPENCODE_API_KEY`. The API base is `https://opencode.ai/zen/v1`.

### Model tiers (decided)

| Tier | Model ID | Input / Output / Cached read / Cached write per 1M | Endpoint |
|---|---|---|---|
| strong | `gpt-6.1-sol` | $2.00 / $10.00 / $0.10 / $2.50 (≤272K ctx) | `/zen/v1/responses` |
| weak | `gpt-6-luna` | $0.10 / $0.50 / $0.01 / $0.125 (≤272K ctx) | `/zen/v1/responses` |

Rationale: 20x price gap; same API, same family, identical tool-call format, so no
request translation. Anthropic models excluded for now (experimentation cost, and
Pro subscription can't be used). Prices from Zen docs on 2026-10-02; stored in
config, not hard-coded.

## Proposed Change

A local HTTP proxy, written in TypeScript on Bun, that speaks the **OpenAI
Responses API**. OpenCode is configured with a custom provider pointing at it.

```
OpenCode ──POST /v1/responses (model: "auto")──▶ agent-scaffold-router (127.0.0.1:8787)
                                                   │ 1. parse input items
                                                   │ 2. detect session + turn
                                                   │ 3. pick tier (policy)
                                                   │ 4. rewrite body.model
                                                   │ 5. log decision
                                                   ▼
                                    https://opencode.ai/zen/v1/responses
                                                   │ SSE stream piped back unchanged,
                                                   │ tee'd to read usage from response.completed
                                                   ▼
                                      decisions.jsonl (one line per request)
```

### Key design decisions (all decided; do not re-litigate in implementation)

1. **Proxy, not plugin.** Works with any harness speaking the Responses API; plugin
   is an optional later add-on (child #8).
2. **Virtual models.** The proxy exposes three model IDs: `auto` (routed),
   `strong`, `weak` (forced tiers). Forced tiers give the eval baselines for free
   through the same logging path.
3. **Routing granularity: per user turn, cheap-first.** The tier is decided when
   a new user message arrives and held for every request in that turn (tool-call
   round trips). Config knob `granularity: "turn" | "session"`; `"session"` decides
   on the first turn and holds for the whole session. Default `"turn"`, unless
   child #1 finds mid-session switching breaks (see rule below).
4. **Escalation is one-way within a turn.** Weak → strong on failure signals;
   never strong → weak mid-turn.
5. **Fail-open to strong.** Any router exception routes to strong with reason
   `router_error`. Upstream errors pass through verbatim (status, headers, body).
   No retries in v1.
6. **Manual override:** `!strong` or `!weak` as the first token of the latest user
   message forces that tier for the turn. Override tokens are stripped from
   **every** user message in `input` on every request, so the forwarded prefix
   stays byte-stable across requests (stripping only the latest one would change
   history on the next turn and break prompt caching).
7. **Auth:** forward the client's `Authorization` header unchanged. If absent, use
   `Bearer $OPENCODE_API_KEY` from the environment. The proxy never logs keys.
8. **Bind 127.0.0.1 only.** The proxy spends the user's money; never listen on
   0.0.0.0 in v1.
9. **Decision rule for the Responses-API state risk (from child #1):** if a
   mid-session `gpt-6.1-sol` ↔ `gpt-6-luna` switch errors (e.g. due to
   `previous_response_id` or encrypted reasoning items) and a fix by stripping or
   rewriting those items is not possible in under 50 lines, default
   `granularity` becomes `"session"` and that's recorded in a progress report.

### Implementation details

#### Turn and session detection (Responses API `input` items)

- **Turn start:** the last item in `input` is a user message
  (`{"type":"message","role":"user"}` or bare `{"role":"user"}`).
- **Turn continuation:** the last item is a `function_call_output` (or any
  non-user item).
- **Session key**, first match wins:
  1. `body.prompt_cache_key` if present (OpenCode/AI SDK may set it to the session ID; child #1 confirms).
  2. If `body.previous_response_id` is present: the session key previously
     recorded for that response ID (in-memory map `responseId → sessionKey`).
  3. `sha256(instructions + first user message text)`, first 16 hex chars.
- **Turn index:** count of user messages in `input` (plus the inherited count
  when `previous_response_id` is used).
- **Stateless recovery:** the turn-start decision is a pure function of the
  latest user message + config, so after a proxy restart a continuation request
  recomputes the same tier from `input`. Escalation state recomputes from the
  current turn's items. In-memory state is a cache, never the source of truth.

#### Heuristic classifier (turn start, `auto` only)

Score the latest user message text (override tokens removed):

| Signal | Points |
|---|---|
| Length > 2,000 chars | +2 |
| Each match from strong keywords (`architect`, `design`, `refactor`, `debug`, `investigate`, `why`, `root cause`, `race`, `deadlock`, `performance`, `security`, `migrate`, `plan`), max +4 | +2 each |
| ≥ 3 distinct file paths (regex `[\w./-]+\.\w{1,5}`) | +1 |
| Fenced code block > 50 lines | +1 |
| Each weak keyword (`rename`, `typo`, `format`, `lint`, `run the tests`, `commit`, `list`, `show me`), max -2 | -1 each |

`score ≥ policy.strongThreshold` (default **3**) → strong; else weak. Keywords and
weights live in config. The decision `reason` records each signal that fired,
e.g. `heuristic:score=4[keyword:debug,len>2000]`.

#### Escalation (within the current turn, `auto` only)

Computed from the items after the turn's user message:
- **Consecutive tool errors:** the last N `function_call_output` items all match
  `/\b(error|exception|traceback|failed|exit code [1-9])\b/i`. N default **3**.
- **Repeated tool call:** the same `function_call` (name + sha256 of arguments)
  appears ≥ M times in the turn. M default **3**.

Either fires → strong for the rest of the turn, reason
`escalate:tool_errors=3` / `escalate:repeat_call=read_file x3`.

#### HTTP surface

| Method + path | Behavior |
|---|---|
| `POST /v1/responses` | Route + forward to `${upstream.baseURL}/responses`. Supports `stream: true` (SSE passthrough) and `stream: false` (JSON). |
| `GET /v1/models` | `{"object":"list","data":[{"id":"auto"},{"id":"strong"},{"id":"weak"}]}` (OpenAI model objects). |
| `GET /healthz` | `200 {"ok":true}` |
| anything else | `404 {"error":{"message":"not supported by agent-scaffold-router"}}` |

Request bodies with `model` not in {auto, strong, weak} → `400` with a message
listing valid models (no silent passthrough: we want every request logged and routed).

#### Config: `~/.config/agent-scaffold-router/config.json` (all fields optional, defaults shown)

```json
{
  "port": 8787,
  "upstream": { "baseURL": "https://opencode.ai/zen/v1", "apiKeyEnv": "OPENCODE_API_KEY" },
  "tiers": {
    "strong": { "model": "gpt-6.1-sol", "price": { "input": 2.0, "output": 10.0, "cachedRead": 0.10, "cachedWrite": 2.50 } },
    "weak":   { "model": "gpt-6-luna",  "price": { "input": 0.10, "output": 0.50, "cachedRead": 0.01, "cachedWrite": 0.125 } }
  },
  "policy": {
    "granularity": "turn",
    "strongThreshold": 3,
    "escalation": { "consecutiveToolErrors": 3, "repeatedToolCalls": 3 },
    "keywords": { "strong": ["..."], "weak": ["..."] }
  },
  "log": { "path": "~/.local/share/agent-scaffold-router/decisions.jsonl", "captureBodies": false }
}
```

#### Decision log line (`decisions.jsonl`)

```ts
interface DecisionLogLine {
  ts: string;               // ISO 8601
  requestId: string;        // proxy-generated ULID
  sessionKey: string;
  sessionKeySource: "prompt_cache_key" | "previous_response_id" | "hash";
  turnIndex: number;
  isTurnStart: boolean;
  requestedModel: "auto" | "strong" | "weak";
  tier: "strong" | "weak";
  upstreamModel: string;    // e.g. "gpt-6.1-sol"
  reason: string;           // e.g. "heuristic:score=4[...]", "override:!strong", "escalate:tool_errors=3", "sticky:turn", "forced", "router_error"
  status: number;           // upstream HTTP status
  usage: { input: number; cachedRead: number; output: number; reasoning: number } | null;
  costUSD: number | null;   // from tier price table
  allStrongCostUSD: number | null; // same usage priced at strong rates (counterfactual, for savings)
  latencyMs: number;        // request start → stream end
  ttftMs: number | null;    // time to first byte from upstream
}
```

`log.captureBodies: true` additionally writes request bodies to
`~/.local/share/agent-scaffold-router/captures/<requestId>.json` with
`Authorization` removed (for debugging and child #1 investigation only).

#### OpenCode wiring (exact v2 config shape verified in child #1)

```jsonc
// opencode.json (provider block; shape to verify against v2 docs)
{
  "provider": {
    "router": {
      "npm": "@ai-sdk/openai",
      "name": "Agent Scaffold Router",
      "options": { "baseURL": "http://127.0.0.1:8787/v1", "apiKey": "{env:OPENCODE_API_KEY}" },
      "models": { "auto": {}, "strong": {}, "weak": {} }
    }
  },
  "model": "router/auto",
  "small_model": "router/weak"
}
```

`small_model: router/weak` sends title generation to the weak tier.

## Child Issues

| # | Title | Priority | Effort (human / CC) | Status | Depends on |
|---|---|---|---|---|---|
| 1 | Passthrough proxy + request capture + Responses-state investigation | Critical | ~1.5d / ~1h | v1 | none |
| 2 | Routing core: virtual models, turn/session detection, heuristics, overrides, escalation, fail-open | Critical | ~2d / ~1.5h | v1 | 1 |
| 3 | Decision log, cost accounting, `report` CLI | High | ~1d / ~45m | v1 | 1 (log), 2 (fields) |
| 4 | Packaging + README + OpenCode setup docs + CI | High | ~0.5d / ~30m | v1 | 2, 3 |
| 5 | Evaluation harness: headless `opencode run` on a task set, auto vs strong vs weak | Medium | ~2d / ~2h | later | 4 |
| 6 | LLM-as-judge router (Luna classifies turn difficulty) | Medium | ~1d / ~1h | later | 3, 5 |
| 7 | `/chat/completions` support + task-specialized model routing (pick model by what each strong model is best at) | Medium | ~2d / ~2h | later | 2, 5 |
| 8 | Optional OpenCode v2 plugin: session/agent ID headers to the proxy | Low | ~0.5d / ~30m | later | 2 |
| 9 | Claude Code harness support | Low | TBD | **blocked**: Pro OAuth can't be routed; needs API-key path decision | 2, 7 |

### Child #1 detail: what the investigation must answer (recorded in the next progress report)

1. Exact OpenCode v2 provider config shape for a custom Responses-API provider.
2. Does OpenCode send `previous_response_id`, `store`, `prompt_cache_key`,
   `include: ["reasoning.encrypted_content"]`, reasoning items, or `item_reference`s?
3. With `log.captureBodies`, does a session that switches `gpt-6.1-sol` →
   `gpt-6-luna` → `gpt-6.1-sol` mid-session succeed? If not, the exact error, and
   whether stripping reasoning items fixes it (applies decision rule 9).
4. What do title-generation and compaction requests look like (distinguishable
   from agent turns)?
5. Does the user's key have access to both `gpt-6.1-sol` and `gpt-6-luna`
   (Zen vs Go plan)? One minimal request to each.

## Dependency Graph

```
#1 Passthrough ──┬──▶ #2 Routing core ──┬──▶ #4 Packaging ──▶ #5 Eval ──┬──▶ #6 LLM judge
                 │                      │                              └──▶ #7 chat/completions + specialization ──▶ #9 Claude Code (blocked)
                 └──▶ #3 Logging ───────┘
                                         #2 ──▶ #8 Plugin (independent after #2)
```

## Sequencing Rationale

- **#1 first** because the biggest unknown (Responses API server-side state
  across model switches) decides whether `granularity: "turn"` is even viable.
  Building the router before knowing that risks rework.
- **#2 and #3 can run in parallel** after #1; #3 needs #2's fields only to fill the log line.
- **#4 before #5:** the eval harness should run against the installable artifact,
  not a dev checkout.
- **#6 and #7 after #5:** you can't tell whether a smarter router or a new model is
  better without the baseline eval.
- **#9 is blocked** on an auth decision outside this codebase.

## Acceptance Criteria (v1 = children #1 to #4)

1. `bunx agent-scaffold-router serve` starts on `127.0.0.1:8787`, and `GET /healthz` returns 200.
2. With the README's `opencode.json`, `opencode run -m router/auto "say hi"` completes and writes exactly 1 line to `decisions.jsonl` with `tier`, `reason`, `usage`, `costUSD` all non-null.
3. A streamed response through the proxy is byte-identical to the same request sent directly to Zen (integration test against a mock upstream replaying a recorded SSE stream).
4. In one OpenCode session of ≥ 3 user turns with tool calls, every request within a turn has the same `tier` unless an `escalate:*` reason appears, and escalation never goes strong → weak.
5. A user message starting with `!strong` produces `reason: "override:!strong"` for all requests in that turn, and no forwarded request body contains the string `!strong` (verified via `captureBodies`).
6. Injecting a thrown error in the classifier yields `tier: "strong"`, `reason: "router_error"`, and the request still succeeds.
7. Upstream 4xx/5xx statuses and bodies reach OpenCode unchanged.
8. `agent-scaffold-router report` prints, per session and in total: request count, % strong, cache-read ratio, actual cost, all-strong counterfactual cost, savings %.
9. Child #1's five investigation questions are answered in the next numbered progress report in `docs/progress/`.
10. `bun test` passes in CI (GitHub Actions) on push.

## Testing Plan

| Layer | What | Count |
|---|---|---|
| Unit | Turn/session detection across item shapes (user msg, function_call_output, previous_response_id, prompt_cache_key) | +8 |
| Unit | Heuristic scoring: each signal, caps, threshold boundary | +10 |
| Unit | Override parse + strip from all user messages | +4 |
| Unit | Escalation: consecutive errors, repeated calls, one-way rule | +5 |
| Unit | Cost calc incl. cached read and the counterfactual | +3 |
| Integration | Mock upstream (Bun server) replaying recorded SSE: byte-identical passthrough, model rewritten, usage logged | +4 |
| Integration | Fail-open, upstream error passthrough, 400 on unknown model, auth header forwarding | +4 |
| E2E (manual, real Zen, ~$0.10) | `opencode run -m router/auto` 3-turn scripted session; check log lines | +1 |

## Rollback Plan

Opt-in and local. Rollback = point OpenCode back at its previous model (`"model"`
in `opencode.json`) and stop the proxy. No shared state, no data migration.
`decisions.jsonl` is append-only and can be deleted.

## Effort Estimate (v1, children #1 to #4)

| Component | Human | CC + gstack |
|---|---|---|
| #1 passthrough + capture + investigation | 1.5d | 1h |
| #2 routing core | 2d | 1.5h |
| #3 logging + report CLI | 1d | 45m |
| #4 packaging + docs + CI | 0.5d | 30m |
| **Total** | **5d** | **~3.75h** |

## Files Reference (to be created)

| File | Purpose |
|---|---|
| `package.json`, `tsconfig.json` | Bun + TS project; `bin: { "agent-scaffold-router": "src/cli.ts" }` |
| `src/cli.ts` | `serve`, `report` subcommands |
| `src/config.ts` | Load + default + validate config |
| `src/server.ts` | `Bun.serve` routes, bind 127.0.0.1 |
| `src/upstream.ts` | Forward request, SSE tee, usage extraction from `response.completed` |
| `src/responses/items.ts` | Turn/session detection over Responses `input` items |
| `src/router/heuristics.ts` | Scoring |
| `src/router/overrides.ts` | `!strong` / `!weak` parse + strip |
| `src/router/escalation.ts` | Failure-signal detection |
| `src/router/policy.ts` | Combines all of the above into `{tier, reason}`; fail-open wrapper |
| `src/log/decisions.ts` | JSONL writer, body capture |
| `src/log/cost.ts` | Pricing + counterfactual |
| `src/report.ts` | Aggregation for `report` |
| `test/**` + `test/fixtures/*.sse` | Unit + integration tests, recorded streams |
| `examples/opencode.json` | Copy-paste OpenCode config |
| `README.md` | Install, configure, how routing works, override syntax |
| `.github/workflows/ci.yml` | `bun test` |
| `docs/progress/NN_progress_report.md` | Child #1 findings (next number in sequence) |

## Out of Scope (this epic)

- Learned or trained routers (heuristics only in v1; LLM judge is child #6).
- Hosted or multi-user deployment; any non-loopback binding.
- Web dashboard (JSONL + `report` CLI only).
- Anthropic models and any use of Claude Pro subscription OAuth.
- Local/Ollama tier.
- `/chat/completions` and cross-format translation (child #7, later).
- Retries, rate limiting, load balancing.

## Open Questions (not blocking v1)

- Should compaction requests be forced to a specific tier? Answer after child #1 shows what they look like.
- Claude Code path (#9): API key via Zen's `/messages` endpoint, or out of scope permanently?

## Related

- `docs/progress/00_progress_report.md` (research)
- [SWE-Router](https://arxiv.org/abs/2607.00053), [cache-safe routing boundaries](https://agentpatterns.ai/patterns/agent-design/cache-safe-routing-boundaries/), [LiteLLM Auto Router v2](https://docs.litellm.ai/blog/autorouter-v2)
