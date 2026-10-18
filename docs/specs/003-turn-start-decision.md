# 003 — Plan: a better turn-start decision

**Date:** 2026-10-18
**Status:** plan only. Nothing is built, and every paid step needs the user's explicit go.
**Context:** [progress report 07](../progress/07_progress_report.md) (Polyglot results)

## Why

The Polyglot run showed that `auto` is only as good as its turn-start decision:

- When it started on strong, it solved 14/18 runs, about as well as strong.
- When it started on weak, it solved 14/42 runs, the same as weak.
- Escalation never fired, because the weak model is confidently wrong rather than visibly stuck.

The current turn-start heuristic does no better than chance at spotting hard exercises:

| exercise group (60 total) | count | auto started on strong |
|---|---|---|
| weak and strong both solve | 20 | 8 |
| **only strong solves** (the 28 the router should catch) | 28 | 6 |
| neither solves | 12 | 4 |

Its signals come from accidents of wording, not difficulty. `files=N` counts things in the docs that look like file names, `weak:list` fires on "list-ops", and `keyword:race` fires on a racing exercise. Prompt length barely differs between the groups: 2,400 characters for the "only strong" group against 2,100 for the "both solve" group.

Weak never solved an exercise that strong failed. So a **perfect** turn-start decision would solve 48/60, as strong does, while paying strong prices on only 28 exercises.

## Goal

Get `auto` closer to 48/60 at well below strong's cost, by deciding better at the start of each turn. A turn starts when a new user message arrives. That covers the first message of a task and also every follow-up message, which brings in the multi-turn case below.

## The two ideas

### 1. A classifier call at turn start

Before the turn's first request, make one cheap call that asks a model whether this is a task a small model will get right. Its input is only what the router sees at that moment: the user's message, plus the system prompt's first lines for context. It answers `weak` or `strong`.

- **Cost:** one call per user turn, not per request. With weak as the classifier, that's about $0.0003. With strong, it's about $0.005, still small next to strong's $0.031 per exercise.
- **Latency:** one extra round trip, about 1–2 seconds, once per turn.
- **Caching:** the router is stateless today, so it recomputes the decision on every request in a turn. The classifier's answer needs to be cached per turn, keyed by session and the turn's user message, using the existing `SessionMemory`.
- **Failure:** if the call errors or times out, use strong, as the router already does for any routing error.
- **Kept as they are:** `!strong` / `!weak` overrides, title and compaction routing, and escalation.

### 2. User pushback goes to strong (multi-turn)

Today every new user message is scored from scratch, and escalation resets with it. So when the weak model claims success and the user replies "that's still broken", the router stays on weak. Yet that reply is the clearest signal we'll ever get that weak failed.

**Rule:** if the previous turn ran on weak, and the new message reads like a correction ("still", "doesn't work", "wrong", a pasted error or traceback), route this turn to strong. The classifier from idea 1 can make this call, since it is given the previous turn's tier, so no separate keyword list is needed.

**Cost of switching mid-session:** the conversation history isn't in strong's prompt cache yet, so the first strong request pays full input price for it. Reasoning items written by weak are also dropped, which `dropForeignReasoning` already handles. This is a one-time cost per switch.

## Keeping it simple, and not overfitting

- **One classifier, one general prompt.** It asks whether a smaller model will get this right. The prompt is written once, before looking at which exercises it gets right, and it never mentions Exercism or coding puzzles. We don't iterate on its wording against the 60 exercises. If the first version doesn't beat the heuristic in replay, we stop and rethink rather than tune it.
- **The 60 exercises only price the rule. They don't shape it.** The held-out 23 (step 3) are the real test.

## Per-turn switching vs. one model per session

Switching models mid-session throws away the prompt cache. The new model has to read the whole history at full input price, and the weak model's reasoning items are dropped. In report 06, cache reads covered 76–82% of input tokens, so switching turns a lot of cheap cached tokens back into full-price ones. Per-turn routing must beat the simple alternative:

| | decide | model for the rest of the session |
|---|---|---|
| **A. per turn** | classifier on every user message (includes pushback) | can change at each user message |
| **B. per session** | classifier on the first user message only | fixed; existing `policy.granularity: "session"` |

On single-turn Polyglot, A and B are the same thing, since there's only one turn. They differ only in multi-turn sessions, so comparing them needs the scripted follow-up turn below. The comparison is solved runs and total cost, including the cache misses after a switch, which the proxy log already records per request.

## How we test it

**Step 1 — free replay.**
- Add `eval/replay.ts`, which takes a finished run plus a decision function.
- For each exercise, it takes the tier the function picks, then looks up that tier's real outcome and cost in the run.
- This prices any rule against the 60 exercises we already ran, without new agent runs.
- It assumes a run that `auto` starts on strong behaves like the plain strong run. The 14/18 result above supports that.
- Baselines:
  - current heuristic: about 26/60
  - perfect decision: 48/60
  - always weak: 20/60
  - always strong: 48/60, at $1.87

**Step 2 — classify the 60 prompts.**
- Run the classifier on each exercise prompt and feed its answers into the replay. This step is **paid but tiny**: about $0.02 with weak as the classifier, or about $0.30 with strong.
- Try both classifier models with the same prompt. No wording iterations (see above).

**Step 3 — held-out check.**
- The 60 exercises were used to choose the rule, so the result on them is optimistic.
- The 23 Python/JS exercises outside the subset are an untouched test set.
- Run weak and strong on them to get labels, about $0.80, then replay the chosen rule.

**Step 4 — live confirmation.**
- Once the rule looks good in replay, build it into the router.
- Run `auto` live on all 83 Python/JS exercises, about $1.50.

**Pushback (idea 2) and per-turn vs per-session (A vs B) can't be tested on single-turn Polyglot.** Both need a scripted second user message after a failed first try, for example "the tests fail:" followed by the test output. That is Aider's second try, but here it stands in for a user follow-up. We dropped a second try from spec 002 because it didn't help compare configs. Here it would be the thing under test. Whether to add it is the user's call (see below).

**Totals:** steps 2–4 cost about $2.50–$3, and the eval has spent $4.60 so far.

## What to build

1. `eval/replay.ts`: reads `results.jsonl`, applies a decision function, and prints solved, cost and $/solved next to the baselines. Free.
2. `src/router/classifier.ts`: one upstream call with a short prompt that returns `weak` or `strong`, with a timeout, and is cached per turn in `SessionMemory`. Wired into `decide()` in place of `scoreMessage` when `policy.turnStart: "classifier"` is set. The heuristic stays the default until the classifier wins in replay.
3. The previous turn's tier goes into the classifier's input, which covers pushback.
4. If the user agrees: an optional scripted follow-up turn in the eval, to test pushback.

## Open questions for the user

1. The classifier model: weak (cheapest) or strong (likely more accurate). Step 2 can try both for about $0.30 in total.
2. Should the eval get a scripted follow-up turn? It is needed to test pushback, and to compare per-turn switching with one model per session.
