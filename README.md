# agent-scaffold-router

A local proxy that sits between [OpenCode](https://opencode.ai) and the model provider and decides, **per user turn**, whether a coding-agent task needs a strong (expensive) model or a cheap, fast one. It logs every decision with its cost, so you can see what routing saved.

```
OpenCode ──(model: router/auto)──▶ agent-scaffold-router on 127.0.0.1:8787 ──▶ OpenCode Zen /responses
                                   picks strong or weak, rewrites the model,
                                   logs tier, reason, tokens and cost
```

Status: v1, experimental. It targets OpenCode v2 and OpenCode Zen's GPT models on the OpenAI Responses API.

| Tier | Default model | Price per 1M tokens (input / output) |
|---|---|---|
| strong | `gpt-6.1-sol` | $2.00 / $10.00 |
| weak | `gpt-6-luna` | $0.10 / $0.50 |

## Quick start

Requirements: [Bun](https://bun.sh) ≥ 1.1, OpenCode v2 (`curl -fsSL https://opencode.ai/v2/install | bash`), and an OpenCode Zen API key.

1. **Give the proxy your Zen key.** Do one of these:
   - connect Zen in OpenCode (`/connect` → OpenCode, or `opencode auth login`), and the proxy reads the stored credential through `opencode auth export`;
   - or `export OPENCODE_API_KEY=...`.

   The key is never logged or written to disk by the proxy.

2. **Start the proxy.** It isn't on npm yet, so run it from a checkout:

   ```sh
   git clone https://github.com/brombaut/agent-scaffold-router && cd agent-scaffold-router
   bun install
   bun src/cli.ts serve          # once published: bunx agent-scaffold-router serve
   ```

   To keep it running in the background, install [`examples/agent-scaffold-router.service`](examples/agent-scaffold-router.service) as a systemd user service (instructions in the file).

3. **Point OpenCode at it** by copying [`examples/opencode.jsonc`](examples/opencode.jsonc) into your project's `opencode.jsonc` (or `~/.config/opencode/opencode.jsonc`). It makes **`router/auto`** the default model; `/models` switches to `router/strong` or `router/weak`. The provider's `apiKey` is a placeholder that the proxy replaces with your real key.

4. **See what it did:**

   ```sh
   bun src/cli.ts report         # once published: bunx agent-scaffold-router report
   ```

   ```
   session                 started           reqs  turns  strong  cache     cost  all-strong  saved
   ses_f0021d6beffer0r0D…  2026-10-03 03:45    16      3     56%    74%  $0.1967     $0.2888    32%
   ```

## Models the proxy serves

| Model | Behavior |
|---|---|
| `router/auto` | Routed per turn (see below). |
| `router/strong` | Always the strong tier. Useful as a baseline. |
| `router/weak` | Always the weak tier. |

Any other model name gets HTTP 400.

## How routing works

- **Decided once per user turn.** A turn starts when you send a message. Every request in that turn (the tool-call round trips) stays on the same tier, so the provider's prompt cache keeps working.
- **Cheap first.** The latest user message is scored:

  | Signal | Points |
  |---|---|
  | longer than 2,000 characters | +2 |
  | strong keywords (`debug`, `why`, `design`, `refactor`, `race`, `security`, …), max 2 counted | +2 each |
  | 3 or more file paths | +1 |
  | a fenced code block over 50 lines | +1 |
  | weak keywords (`rename`, `typo`, `format`, `lint`, `commit`, `show me`, …), max 2 counted | −1 each |

  A score ≥ 3 goes to strong; anything lower goes to weak.
- **Escalation is one-way.** Within a turn, the weak tier is swapped for strong after 3 consecutive tool errors, or after the same tool call (same arguments) repeats 3 times. It never moves back to weak within that turn.
- **Overrides.** Start a message with `!strong` or `!weak` to force that turn. The token is removed before the request is forwarded.
- **Fail-open.** If the router itself throws, the request goes to strong (`reason: router_error`). A router bug costs money, not quality.
- **Special requests.** Title generation goes to weak. Compaction (summarizing a long session) goes to strong by default; change it with `policy.compactionTier`.
- **Portable history.** Zen rejects one model's encrypted reasoning items in another model's request. The proxy records which model produced each reasoning item and drops the other model's items before forwarding. Each model keeps its own.

## Configuration

Optional: `~/.config/agent-scaffold-router/config.json`. Every field has a default; the defaults are in [`src/config.ts`](src/config.ts).

```json
{
  "port": 8787,
  "upstream": { "baseURL": "https://opencode.ai/zen/v1", "apiKeyEnv": "OPENCODE_API_KEY", "auth": "inject" },
  "tiers": {
    "strong": { "model": "gpt-6.1-sol", "price": { "input": 2.0, "output": 10.0, "cachedRead": 0.1, "cachedWrite": 2.5 } },
    "weak": { "model": "gpt-6-luna", "price": { "input": 0.1, "output": 0.5, "cachedRead": 0.01, "cachedWrite": 0.125 } }
  },
  "policy": {
    "granularity": "turn",
    "strongThreshold": 3,
    "escalation": { "consecutiveToolErrors": 3, "repeatedToolCalls": 3 },
    "titleTier": "weak",
    "compactionTier": "strong",
    "classifier": { "mode": "off", "model": "strong", "timeoutMs": 10000 }
  },
  "log": { "path": "~/.local/share/agent-scaffold-router/decisions.jsonl", "captureBodies": false }
}
```

- `policy.granularity: "session"` decides once from the session's first message and holds that tier.
- `upstream.auth: "forward"` passes OpenCode's own `Authorization` header through, instead of having the proxy inject the key.
- `policy.keywords.strong` / `policy.keywords.weak` replace the keyword lists.
- `policy.classifier` (experimental, [spec 003](docs/specs/003-turn-start-decision.md)) makes one call to the `model` tier at the start of each turn, asking whether the message needs strong. Its answer is shared by every request in that turn, and on follow-ups it's told which model handled the previous turn. Modes:
  - `"off"` (the default): no classifier calls.
  - `"on"`: routes by the classifier instead of the keyword score. It adds one round trip per turn.
  - `"shadow"`: routes by the keyword score and logs the classifier's pick, with no added latency.
  - `"experiment"`: each session is randomly `"on"` or `"shadow"`, for comparing the two.

  When the classifier is running, turn-start log lines carry `arm`, `classifierTier`, `heuristicTier`, `classifierCostUSD` and the first 500 characters of your message (`turnPreview`), so the log can be analyzed afterwards. `report` includes the classifier's cost.

## Logs and reports

Every request appends one JSON line to `decisions.jsonl` with:
- the session, turn, request kind, requested model, tier, upstream model and reason (e.g. `heuristic:score=4[keyword:debug,keyword:why]`, `override:!weak`, `escalate:tool_errors=3`);
- token usage (including cache reads and writes), cost, the cost if the same tokens had gone to strong, latency and any error.

`report` aggregates this per session: requests, turns, % strong, cache-read ratio, actual vs all-strong cost, and savings. Options:
- `--since 2026-10-01` limits it to recent entries.
- `--json` prints machine-readable output.

The "all-strong" figure reprices the same tokens. A real all-strong session would take different turns, so treat it as an estimate.

`serve --capture` also writes each forwarded request body, its headers (with credentials removed) and the raw response under `~/.local/share/agent-scaffold-router/captures/`. **Captures contain your code and prompts**; use this only for debugging.

## Local dashboard

```sh
bun src/cli.ts dashboard               # http://127.0.0.1:8788
bun src/cli.ts dashboard --port 8790    # optional separate port
```

The dashboard reads the configured `log.path` and polls every **one second**. It is a
separate, read-only Bun server: no proxy restart, credentials, or changes to routing
or the running classifier experiment. Stop it with Ctrl-C. Missing logs show an empty
state and appear automatically when the file is created.

The compact, dark dashboard is organized around questions, not internal experiment
terminology. Small means the weak tier; Strong means the strong tier. A user message
can trigger several model calls. Select all history or the last 24 hours, 7 days, or 30 days.

- **Overview — is routing helping?** A live timeline shows each completed model call
  over a rolling 5-, 15-, or 60-minute window (5 minutes by default); new Small or Strong
  calls briefly pulse in their tier color. The window keeps sliding during idle periods,
  with old calls expiring automatically; new log entries are still fetched every second.
  Three graphs follow: cumulative recorded
  spend versus the same-token Strong-only estimate, daily Small and Strong call-count
  lines, and four AI-versus-rules choice counts. Unknown-tier calls are listed separately. Cumulative spending starts at
  the beginning of the selected range, not the beginning of all history. Missing pricing
  is flagged. Below are conversation/message/call counts and the latest 80 completed
  model calls with readable reasons. Expand a call for its exact reason, upstream model,
  raw conversation ID, and latency; detailed routing counts remain expandable.
- **Spending — what is it costing?** Recorded spend, estimated savings, and a daily
  spending chart. The comparison estimates what the same tokens would cost using
  Strong for every call. Individual call costs exclude the AI's selection fees;
  spending totals include them. Incomplete pricing is explicitly flagged.
- **Conversations — what happened during my task?** Sort by recency, cost, message count,
  or model changes. Model-history marks are grouped by user message. Open a conversation
  and expand a message for its private preview and routing details. Changes between
  messages compare the previous message's **final** model tier with the next one's
  initial tier; switches while handling a single message are shown separately.
- **Routing comparison — does AI choose differently from the rules?** “AI-selected
  conversations” use the classifier's choice (`on` in the log). “Rule-selected
  conversations” use keyword rules while recording, but not using, the AI prediction
  (`shadow` in the log). The UI explains these groups without requiring log terminology.
  Counts show conversations and evaluated user messages, plus how often suggestions
  differed and concrete examples. Historical entries without an `arm` are excluded;
  tool-call round trips do not create new comparisons. Four choice counts distinguish
  both choosing Small, both choosing Strong, and each direction of disagreement.
  Different choices do **not** establish better task results.

  Conversation links show a whitespace-normalized excerpt (at most 72 characters)
  of the first recorded nonblank message, not a generated title. This label is shared
  across views and retained across date filters using the full log only for identity.
  When no preview was recorded, a stable label such as “Conversation a12b34” is used.
  Full recorded previews remain in expanded message details; no paid model calls or
  additional files are used to name conversations.
- **Response timing** (secondary diagnostics): latency and response-header timing,
  sample counts, errors (including errors inside HTTP 200 streams), all statuses,
  and failed-call details. The existing `ttftMs` log field measures upstream response
  headers, **not the first token**; the UI labels it accordingly without changing
  the proxy's instrumentation.

Parsing and cost totals reuse `src/report.ts`. Actual cost includes the classifier;
its cost is also shown separately. Calls without recorded costs are counted and flagged
as incomplete coverage, not presented as free. The all-strong figure reprices the same tokens,
not a separate all-strong session. Charts show only days with activity, and per-day
session counts are active sessions (not necessarily new sessions). Date filtering
can include partial turns; turn counts follow the report's logged agent turn-starts.
Session dates show first activity **in the selected period**, not necessarily the session's creation.
Only completed/logged requests are visible—this is not an in-flight request monitor.

**Privacy:** it binds to `127.0.0.1` only and serves its own HTML, scripts, and styles,
with no CDN or external calls. API responses are not cached; cross-origin requests
and foreign Host headers are rejected. Previews and error text are rendered as text,
not HTML. Anyone with access to your local dashboard can see the previews; don't
expose the port through tunnels or port forwarding.

## Caveats

- **Keep `settings.transport: "http"`** in the provider config. A WebSocket transport sends only deltas, which bypasses per-request routing.
- **Don't enable native compaction** (`settings.compaction.type: "native"`) on the router provider. Its encrypted checkpoint only works with the model that created it.
- **`opencode run` can hang** before sending anything (OpenCode 2.0.22; not yet root-caused). Adding `--print-logs --log-level error` has avoided it in our testing.
- **The proxy listens on 127.0.0.1 only.** It spends your money, so don't expose it.

## Development

```sh
bun install
bun test             # unit + integration tests against a mock upstream
bun run typecheck
bun src/cli.ts serve --capture
```

Design notes and the project's history are in [`docs/`](docs/): the [spec](docs/specs/001-epic-agent-scaffold-router.md) and numbered [progress reports](docs/progress/).
