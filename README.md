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

3. **Point OpenCode at it** by copying [`examples/opencode.jsonc`](examples/opencode.jsonc) into your project's `opencode.jsonc` (or `~/.config/opencode/opencode.jsonc`). Then pick **`router/auto`** with `/models`, or run:

   ```sh
   ASR_CLIENT_KEY=unused opencode run -m router/auto "explain this repo"
   ```

   `ASR_CLIENT_KEY` only needs to exist: OpenCode wants a credential for the custom provider, and the proxy replaces it with your real key.

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
    "compactionTier": "strong"
  },
  "log": { "path": "~/.local/share/agent-scaffold-router/decisions.jsonl", "captureBodies": false }
}
```

- `policy.granularity: "session"` decides once from the session's first message and holds that tier.
- `upstream.auth: "forward"` passes OpenCode's own `Authorization` header through, instead of having the proxy inject the key.
- `policy.keywords.strong` / `policy.keywords.weak` replace the keyword lists.

## Logs and reports

Every request appends one JSON line to `decisions.jsonl` with:
- the session, turn, request kind, requested model, tier, upstream model and reason (e.g. `heuristic:score=4[keyword:debug,keyword:why]`, `override:!weak`, `escalate:tool_errors=3`);
- token usage (including cache reads and writes), cost, the cost if the same tokens had gone to strong, latency and any error.

`report` aggregates this per session: requests, turns, % strong, cache-read ratio, actual vs all-strong cost, and savings. Options:
- `--since 2026-10-01` limits it to recent entries.
- `--json` prints machine-readable output.

The "all-strong" figure reprices the same tokens. A real all-strong session would take different turns, so treat it as an estimate.

`serve --capture` also writes each forwarded request body, its headers (with credentials removed) and the raw response under `~/.local/share/agent-scaffold-router/captures/`. **Captures contain your code and prompts**; use this only for debugging.

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
