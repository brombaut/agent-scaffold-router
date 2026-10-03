# 02 — Child #1: passthrough proxy and the Responses-state investigation

**Date:** 2026-10-02
**Phase:** First code; child #1 of the [v1 epic](../specs/001-epic-agent-scaffold-router.md)
**Previous:** [01 — v1 epic spec](01_progress_report.md)
**Branch:** `feat/01-passthrough-proxy`

## What we did

- **Tooling:** installed gstack (required by `CLAUDE.md`), Bun 1.4.2 and gbrain (local PGLite; config recorded in `CLAUDE.md`).
- **OpenCode v2:** upgraded OpenCode from **1.18.31 to v2.0.22**. The v2 builds ship as `@opencode/cli` through `https://opencode.ai/v2/install`, not through `opencode upgrade`, whose channel tops out at 1.18.34. The v1 binary is backed up at `~/.opencode/bin/opencode-1.18.34.bak`.
- **Passthrough proxy (Bun + TypeScript):**
  - `src/server.ts`: `POST /v1/responses`, `GET /v1/models`, `GET /healthz`; binds to 127.0.0.1 only.
  - `src/upstream.ts`: forwards the body bytes unchanged, tees the SSE stream and logs once the stream ends.
  - `src/sse.ts`: usage parsing.
  - `src/responses/inspect.ts`: request-shape summary without content.
  - `src/log/requests.ts`: JSONL log plus optional body capture.
  - `src/auth.ts`: key resolution.
  - `src/cli.ts`: `serve [--port N] [--capture]`.
- **Tests:** 13, run against a mock upstream (`test/`). They cover byte-identical SSE passthrough, usage extraction across chunk boundaries, auth inject/forward, upstream 4xx passthrough, 502 when the upstream is unreachable, routes, and confirming that captures never contain the key. `bun test` and `tsc --noEmit` both pass.
- **Live investigation:** ran against Zen through the proxy with `--capture`. Scratch project with a one-bug `math.ts`; 3-turn OpenCode session; a manual compaction; untitled sessions for title generation; one replayed request. Working config: [`examples/opencode.jsonc`](../../examples/opencode.jsonc).

## Answers to the five investigation questions (spec, child #1)

**1. OpenCode v2 config for a custom Responses provider.** See [`examples/opencode.jsonc`](../../examples/opencode.jsonc):
- Top-level `providers` (plural), with `package`, `env`, `settings.baseURL`, `settings.transport` and `models`.
- `package` must be `@opencode/ai/providers/openai/responses`. The [v2 providers doc](https://opencode.ai/v2/docs/providers/) also lists `@opencode/ai/providers/openai-compatible/responses`, but 2.0.22 fails with `Cannot find package '@opencode/ai'`; that name isn't in the binary (checked with `strings`).
- Model references look like `router/gpt-6-luna`.
- The spec's `provider` / `npm` / `small_model` shape is v1 syntax and is superseded.

**2. Stateful Responses features OpenCode uses.** Every request had:
- `store: false` and **no `previous_response_id`**: OpenCode is stateless and resends the full history each time.
- `prompt_cache_key` = **the OpenCode session ID** (`ses_…`), a reliable session key.
- `include: ["reasoning.encrypted_content"]`.
- `text.verbosity: "low"`, `max_output_tokens: 32000`, `stream: true`, 11 tools, about 64K characters of `instructions`. That makes about **18K input tokens per request before any conversation**.
- No `item_reference`s.
- Reasoning items (`rs_…` with `encrypted_content`) and `fc_…` item IDs appear **only within the current turn**. OpenCode strips them from earlier turns.

**3. Mid-session model switch.** Works with no errors in every case tested:
- **Between turns, Sol → Luna → Sol in one session:** all requests returned 200. Luna made the fix, and Sol then confirmed it.
- **Within a turn, Luna → Sol:** replaying Luna's mid-turn request, including its `rs_` reasoning item, encrypted content and `fc_` IDs, against `gpt-6.1-sol` returned 200. This is the escalation path in #2.
- **Strong → weak within a turn:** not tested. The spec never does it (one-way escalation).
- **Conclusion:** decision rule 9 does not fire, and `granularity: "turn"` stays the default.
- **Correction (see [report 03](03_progress_report.md)):** the mid-turn replay was sent without OpenCode's session headers. With those headers, Zen rejects Luna's reasoning items sent to Sol (HTTP 400). Turn granularity still holds, but only because the router now drops reasoning items another model produced.

**4. Title-generation and compaction requests.**
- **Title:** **0 tools**, about 2.1K characters of `instructions`, one user message, the session's `prompt_cache_key`, and it runs in parallel with the first agent request. Easy to tell apart.
- **Compaction:** it looks like a normal turn start (11 tools, same instructions, ends in a user message) on the session's current model. The last user message begins `"You MUST summarize the conversation above into a structured summary"`. The router must detect it explicitly, or the heuristic will classify the summary prompt as a user turn.
- **Untitled sessions hung:** on the custom provider, untitled sessions hung before any request reached the proxy (2 of 2 attempts). After pinning `agents.title.model` to `router/gpt-6-luna`, 3 of 4 runs finished in about 2 seconds. The fourth hung, probably still contending with the hung runs before it. **Not root-caused.** The same untitled prompt on the built-in `opencode/gpt-5.4-nano` works without the pin.

**5. Key access.** Your Zen key reaches both `gpt-6.1-sol` and `gpt-6-luna` on `/zen/v1/responses`. One 11-token request to each returned 200. OpenCode v2 lists both models, along with `gpt-6-sol` and `gpt-6-astra`.

## Issues encountered

- **The spec's environment facts were wrong for this machine.** Report 01 recorded OpenCode v2.0.14 with a `config.json` that set an Ollama default. This machine had v1.18.31 and an empty `opencode.jsonc`. We upgraded to v2 rather than retargeting v1.
- **The v2 docs are ahead of the 2.0.22 binary** on package names (see Q1).
- **Cache writes are reported separately.** Zen's usage includes `input_tokens_details.cache_write_tokens`, a subset of `input_tokens` billed at the higher cache-write rate. We added `cacheWrite` to `Usage`; the cost math in #3 must use it.
- **Compaction gets no prompt-cache hits.** It re-serializes earlier user messages as quoted strings, which changes the prefix, so the whole context (19K tokens here) is billed fresh.
- **gstack's headless browser can't start Chromium on this Ubuntu box.** AppArmor blocks unprivileged user namespaces. It works with `GSTACK_CHROMIUM_NO_SANDBOX=1`, which we only used for reading public docs.

## Decisions and rationale

| Decision | Alternatives | Why |
|---|---|---|
| **Keep `granularity: "turn"`** | Fall back to `"session"` (rule 9) | Q3: switches within and across turns both succeed. |
| **Upstream auth defaults to `inject`.** The proxy holds the Zen key, from `OPENCODE_API_KEY` or OpenCode's stored `opencode` credential read in-process via `opencode auth export`, and replaces the client's header. `forward` remains a config option. | Forward the client header (spec decision 7) | A custom provider in OpenCode has its own credential slot, so forwarding would mean storing the Zen key a second time. Injecting keeps one source of truth, and the key is never printed or logged. **This changes spec decision 7.** |
| **Pin `settings.transport: "http"`** | Default transport | The v2 docs say Responses providers may use WebSockets and send only the delta per step. That would hide most requests from a per-request router. |
| **Pin the title agent to the weak tier** | Leave it unset | Same intent as the spec's `small_model: router/weak`, and it avoided the untitled-session hang in testing. |
| **Passthrough accepts real model IDs for now** | Only `auto`/`strong`/`weak` | Child #1 needed real IDs for the switch test. #2 adds the virtual models and the 400 for unknown models. |

## Results

| Measure | Value |
|---|---|
| Live requests | 17 |
| Total spend (from captured usage at Zen prices) | **$0.16** (Sol $0.153, Luna $0.010) |
| Baseline input per agent request | about 18K tokens (instructions + 11 tool schemas) |
| Cache hits within a turn (requests 2 and 3) | about 99% of input (18,042 of 18,125; 18,122 of 18,317) |
| First request on Luna after Sol turns | 0 cached (cold) |
| Back on Sol after a Luna turn | 18,314 of 18,581 cached (Sol's cache stayed warm) |

The cache numbers back up the LiteLLM finding in [report 00](00_progress_report.md): a switch doesn't evict the other model's cache. The cost of a switch is one cache write on the model you switch to, about 18K tokens: roughly $0.045 at Sol's write rate, under $0.003 on Luna.

## Open questions / next steps

1. **Compaction tier.** Compaction re-reads the whole context uncached, so on a long session it is the most expensive single request. Weak saves the most, but a bad summary hurts every later turn. Proposal for #2: route compaction to strong by default, with a config option, and measure in #5.
2. **Native compaction can't coexist with routing.** Native (provider-side) compaction produces an encrypted checkpoint tied to one model ([v2 compaction doc](https://opencode.ai/v2/docs/compaction/)). The README should say to leave `settings.compaction` at the default `summary` when using the router.
3. **Root-cause the untitled-session hang** (OpenCode issue or config?) before writing the README setup steps.
4. **Next:** child #2 (routing core) and #3 (log, cost and `report`) can now start in parallel:
   - Session key = `prompt_cache_key`.
   - Turn start = last input item is a user message, excluding title (0 tools) and compaction (summary-prompt prefix).
