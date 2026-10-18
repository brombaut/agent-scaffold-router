# 08 — Turn-start classifier: free replay and a negative result

**Date:** 2026-10-18
**Phase:** router improvements after the eval (child #5), on `main`
**Previous:** [report 07](07_progress_report.md) (Polyglot results)
**Plan:** [spec 003 — a better turn-start decision](../specs/003-turn-start-decision.md)

## What we did

1. **Wrote spec 003** (commit `fe559da`). It proposes one cheap model call at each turn start that answers `weak` or `strong`, with two rules:
   - one general prompt, with no wording tuned against the eval;
   - per-turn switching must beat keeping one model per session, because switching loses the prompt cache.
2. **Built a free replay** in `eval/replay.ts` (commit `16cef1e`).
   - For a finished run, it prices any per-task weak/strong pick using that tier's real outcome and cost.
   - It reproduces the run's always-weak and always-strong numbers exactly.
3. **Built the classifier** in `src/router/classifier.ts`.
   - It makes one Responses call with low reasoning effort.
   - It returns strong on any error, timeout or unclear answer, as all routing failures do.
   - It has a unit test (`test/classifier.test.ts`) and isn't wired into the router yet.
4. **Ran it on the 60 Polyglot prompts** (`eval/classify.ts`, paid): once with weak as the classifier ($0.008) and once with strong ($0.107). Output: `eval/runs/classify/` (gitignored).
5. **Added `--followup` to the eval.**
   - When turn 1 fails, the runner sends a second user message in the same OpenCode session (`opencode run --session <id>`). The message is the test output plus Aider's second-try text (`benchmark/prompts.py` `test_failures`).
   - It records `solved` as the final outcome and `solvedFirst` as the turn-1 outcome, plus `followupTier`, the tier auto picked for turn 2.
   - The summary gets a "1st turn" column.
   - Checked with a mock run only; no live run yet.

Spend this period: $0.115. Total live eval spend: **$4.72**.

## Issues encountered

- **The classifier can't tell hard from easy on these prompts.** See Results.
- **Pasted test output goes to strong by accident.** In the `--followup` mock run, both turn-2 messages scored 3 (`len>2000` plus `files=7` or `files=12`, counting file paths in tracebacks), so auto routed turn 2 to strong. Under today's heuristic, a follow-up that pastes a long error log is likely to reach strong. A short one ("that's still broken") stays on weak, because a new user message is scored from scratch and escalation resets with it.

## Decisions and rationale

| Decision | Alternatives | Why |
|---|---|---|
| Price rules with a free replay of a finished run before any new agent runs. | Live A/B runs for each rule | No new agent runs. The replay is exact for always-weak and always-strong. |
| One general classifier prompt, written once, never iterated against the 60 exercises (user, 2026-10-18). | Iterate on wording until it fits | Tuning the prompt on 60 exercises would overfit. If the first version loses, we rethink rather than tune. |
| **Stop the classifier line on Polyglot** (2026-10-18). | Reword the prompt; try more signals | It tied the keyword heuristic and did no better than chance (Results). This was the stop condition we set in advance. |
| Any per-turn rule must be compared with one model per session (user, 2026-10-18). | Judge per-turn rules on solves alone | Switching models mid-session discards the cached history, and cache reads are 76–82% of input tokens (report 06). |
| Build `--followup` as Aider's second try, in the same session. | A made-up user reply | Pasting the test output is what a real user does after a failed attempt. It is also the only way to test pushback, and per-turn vs per-session routing, on Polyglot. |
| Cap the follow-up's test output at the last 20k characters. | Send it uncapped, as Aider does | Keeps a pathological jest dump from blowing up the prompt. It's marked `ponytail:` in `eval/run.ts`. |

## Results

Replay against `eval/runs/2026-10-17T23-33-02/` (60 exercises, 1 rep). Classifier rows include the classifier's own cost.

| rule | solved | strong picks | cost |
|---|---|---|---|
| always weak | 20/60 | 0 | $0.14 |
| current heuristic | 25/60 | 18 | $0.69 |
| weak model as classifier | 21/60 | 4 | $0.27 |
| strong model as classifier | 25/60 | 13 | $0.68 |
| perfect | 48/60 | 28 | $0.94 |
| always strong | 48/60 | 60 | $1.87 |

- **Weak as classifier** said weak for 56 of 60 exercises. It is as overconfident judging a task as it is doing it.
- **Strong as classifier** picked strong 13 times, and only 5 of those 13 were exercises that need strong. Since 28/60 (47%) need strong, chance would give about 6 of 13.
- **Weak never solved an exercise strong failed**, so a perfect turn-start rule would match strong's 48/60 at half its cost. The gap is real, but neither the heuristic nor the classifier can see it in the request text.
- **Likely cause:** what makes these exercises hard for weak is mostly details the tests check but the instructions never state (report 07's spot-checks). A judge reading only the request has nothing to go on.

## Open questions / next steps

1. **The user's proposed real-world experiment:** use the classifier on everyday work for a few days, then turn it off for a few days, then analyze the logged trajectories. See the conversation of 2026-10-18 for the design caveats: log the classifier in shadow mode on both kinds of day, and use pushback, overrides and session cost as outcome signals. It needs the classifier wired into the router first.
2. **A `--followup` Polyglot run** to measure pushback, and per-turn vs one model per session. Needs a go and a budget.
3. Signals available only after weak has tried, such as a cheap review of weak's diff. These need `--followup`-style data first.
