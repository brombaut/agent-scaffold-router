# 00 — Initial research: the routing landscape

**Date:** 2026-10-02
**Phase:** Research, before any spec or code

## Goal

Build an "agent scaffold router": a component that sees each model request (or
session/turn) from a coding-agent harness and decides whether it needs a strong
model or a cheaper, faster one. Target harness for v1 is **OpenCode** (v2.0.14
installed locally); **Claude Code** comes later.

## What we did

- Weighed two places to put the router: an **API proxy** (OpenCode → proxy →
  provider) and an **OpenCode plugin**.
- Inspected the local OpenCode v2.0.14 binary for plugin hook names.
- Surveyed papers, blog posts and existing tools on LLM routing, specifically
  for multi-turn coding agents.

## Key findings

### 1. Single-turn routing results don't transfer to agents

- [RouteLLM](https://lmsys.org/blog/2024-07-01-routellm/) (LMSYS): ~95% of GPT-4
  quality with only 14–26% strong-model calls. But that was measured on
  single-turn Q&A (MT-Bench, MMLU, GSM8K).
- Practitioners report that these numbers [do not carry over to tool-calling
  agent workflows](https://yage.ai/share/agentic-multi-model-routing-en-20260729.html).
  The canonical failure: a per-request router sees "looks good, commit it",
  judges it trivial, and sends it to a tiny model that ignores the session
  context. **Judging the latest message alone, with no session context, is a
  known trap.**

### 2. Prompt caching is the dominant practical constraint

- Provider caches are per model. Switching models means re-sending the full
  context at uncached rates (Anthropic cache reads get up to a 90% discount).
  [JFrog](https://jfrog.com/blog/why-model-routing-backfires) argues that switching
  mid-session often costs more overall.
- [Cache-safe routing boundaries](https://agentpatterns.ai/patterns/agent-design/cache-safe-routing-boundaries/):
  break-even is about 8 requests for a one-way Opus→Sonnet switch and about 27
  if you switch back later. Safe switch points: **session start, subagent
  launch, or a fresh side lane seeded with a compact summary**.
- Counterpoint, from [LiteLLM's measurements](https://docs.litellm.ai/docs/auto_router/prompt_caching):
  97.4% cache hits across 4,684 real model switches. A switch doesn't evict
  anything, so returning to model A finds its prefix still warm. The real cost
  is the cache *write* on model B, not losing A's cache.
- Other cross-model hazards: Anthropic `thinking` blocks/signatures and
  provider-specific tool-call formats.

**Implication:** the router must account for cache cost. A switch is only worth
it if the work done on the cheaper model is long enough to pay back the cache
write.

### 3. What works for coding agents specifically

- [SWE-Router](https://arxiv.org/abs/2607.00053) (Jul 2026): the cheap model
  explores for a few turns, then the router reads the partial trajectory and
  either continues cheap or escalates. Includes a Bayes-optimality result
  (looking at the trajectory never makes routing worse). **They released a
  multi-LLM trajectory dataset, which could be useful for training/eval.**
- [Scrouting / SuperScout](https://arxiv.org/pdf/2608.04804) (Aug 2026): a 7B
  scout explores the repo, then routing happens. It matched the top single
  model's solve rate on SWE-bench Pro at about 1/5 the cost per solve. Much of
  the gain came from the scout's *handoff notes*, so routers have to be
  evaluated as whole workflows, not as standalone classifiers.
- [Unblocked](https://getunblocked.com/blog/model-routing-coding-agents/):
  invoices drop 30–40% at first, but "almost right" output from cheap models
  causes retry/debug loops that cancel the savings. Escalating on failure
  (cascading) did better than one-shot routing. Measure **token yield / cost per
  accepted outcome**, not cost per token.
- [Arize](https://arize.com/?p=31923): the biggest real-world wins came from
  frontier-orchestrator + cheap-subagent setups and from a cheap driver with a
  frontier advisor (daily bot went from $100 to about $15–20 per run). Cutting
  context often beats upgrading the model.
- [Harness-native agentic routing](https://arxiv.org/abs/2607.11399): routes at
  the step level using the full harness state. Every decision is logged as
  (state, choice, trace, outcome, cost), so the router improves over time.
- **Baseline to beat** (vLLM Semantic Router team): a multi-model system must
  outperform the *best single fixed model* at about the same budget, call
  count and latency, or it isn't worth the complexity.

### 4. Existing tools

| Tool | Approach | Notes |
|---|---|---|
| [claude-code-router](https://www.morphllm.com/claude-code-router) | Proxy for Claude Code | Routes by request *type* (default/background/think/longContext/webSearch); static rules, no difficulty prediction |
| [LiteLLM Auto Router v2](https://docs.litellm.ai/blog/autorouter-v2) | Proxy | Tiers (SIMPLE/MEDIUM/COMPLEX/REASONING), heuristic scoring + keyword rules + optional Haiku classifier, Thompson-sampled pools, optional session affinity. Lesson: "predictable beats clever for debuggability" |
| [RouteLLM](https://github.com/lm-sys/routellm) | Library / OpenAI-compatible server | Trained strong/weak routers; single-turn focus |
| vLLM Semantic Router | Proxy | Semantic classification → backend |
| OpenRouter auto / Not Diamond | Hosted | `openrouter/auto` (Not Diamond-powered) deprecated in favor of `auto-beta` |
| Cursor Auto | Built-in | Routes every request; [openly accepts losing the cache](https://forum.cursor.com/t/model-changes-mid-conversation-in-the-auto-routers/166831); users complain |
| Claude Code built-ins | Built-in | Explore subagent runs on Haiku; `opusplan` (Opus plans, Sonnet executes) |
| OpenCode subagents | Built-in config | Per-agent models; [opencode-subagent-models](https://github.com/Yivas/opencode-subagent-models) plugin |

### 5. OpenCode v2 plugin API

- The v1 `chat.params` hook (the obvious per-request hook) is **gone in v2**.
  Per the [v1→v2 migration guide](https://opencode.ai/v2/docs/build/plugins/migrate-v1),
  its role is split into `ctx.session.hook("context", ...)`, `"model.request"`
  and `"http.request"`.
- According to the docs, **no hook can switch the session's selected model**.
- However, `ctx.session.hook("http.request")` can rewrite the request body,
  which includes the `model` field, and `http.response` can observe usage.
  [opencode-jev-router](https://github.com/robertn702/opencode-jev-router/issues/52)
  is moving to this approach. A v2 plugin can therefore act as an **in-process
  proxy** that also has session/agent context. It can't change the URL, so it
  can't switch providers.
- ⚠️ These details came via a summarizing fetch tool. Verify against OpenCode
  source/types before relying on them.

## Decisions and rationale (tentative, to be finalized in the spec)

1. **The core router is an HTTP proxy.** It works with any harness, so the same
   component later serves Claude Code via `ANTHROPIC_BASE_URL`. An optional thin
   OpenCode v2 plugin can add session/agent IDs as headers, fixing the proxy's
   main blind spot (no session context).
2. **Default to keeping a session on one model, and escalate rarely.** Decide at
   session or turn start. Switch only when the cache math says it pays off, or
   on failure signals (repeated tool errors, failing tests, loops).
3. **Cheap-first with escalation is the leading strategy.** SWE-Router, the
   Unblocked cascade results and the Arize experience all point to escalating
   on evidence over predicting difficulty up front.
4. **The evaluation compares against the best fixed model**, measuring cost per
   solved task with cache-aware cost accounting.

## Open questions

- Routing granularity: per session, per user turn, or per step with cache-aware gating?
- Model pair: Opus 5.5 / Sonnet 5.5 / Haiku 4.5? Same provider (required for a
  plugin-only approach) or mixed?
- Proxy language: TS/Bun (close to the OpenCode ecosystem) vs Python (ML
  tooling, LiteLLM, RouteLLM)?
- Build on LiteLLM's proxy or write a minimal one?
- Benchmark: a SWE-bench Lite/Verified subset, the SWE-Router trajectory
  dataset, or custom repo tasks via headless `opencode run`?

## Next step

Write the spec (`/spec`) using these findings as input.
