# 16 — Post-compaction turns no longer reuse an earlier classifier answer

**Date:** 2026-11-07
**Previous:** [report 15](15_progress_report.md)
**Issue:** [#3](https://github.com/brombaut/agent-scaffold-router/issues/3)

## What we did

- Confirmed the bug in the live log (`~/.local/share/agent-scaffold-router/decisions.jsonl`, read only). It has two `kind: "compaction"` lines, in sessions `ses_e8b1…` (2026-10-26) and `ses_e762…` (2026-10-29). In both, `turnIndex` falls from 16 and 12 back to 2 right after the compaction, so later turns reuse keys that earlier turns had already filled.
- Changed the classifier cache key in `classifyTurn` (`src/server.ts`) from `${sessionKey}#${turnIndex}` to `${sessionKey}#${turnIndex}#${sha256(turnText)[0:12]}`. Requests within one turn share the same latest user message, so they still share one classification.
- Added a regression test to `test/classifier-routing.test.ts`: two turns in the same session with the same user-message count but different text must each call the classifier once. The test fails without the fix.

## Issues encountered

- The bug was already affecting the everyday experiment. After the two compactions there were 28 turn starts, all in the `on` arm, and none got a new classifier call or a `turnPreview`. About 690 requests came after those compactions. They were routed by the classifier's answer to an earlier, different message, and their log lines have no `classifierCostUSD`, `classifierRaw` or `turnPreview`.

## Decisions and rationale

- **Fixed during the experiment** (user's call: "Tackle #3"). The other option was to leave the code alone and drop post-compaction turns at analysis time. HANDOFF §3 says not to change the classifier mid-experiment. This fix doesn't change the classifier's prompt or decision rule, though. It only stops answers being reused across different messages, so the `on` arm now does what it was always meant to do.
- **Hash the text instead of resetting `turnIndex` at compaction.** Resetting would need the proxy to track compaction per session. The hash needs no extra state and also covers any other case where the user-message count goes back down.
- Two turns with identical text and the same post-compaction index (e.g. "continue" twice) still share an answer. Since it is the same message, that is harmless.

## Results

- `bun test`: **74 passed, 0 failed**. `bun run typecheck` passed.
- No proxy restart, no paid calls, no commit.

## Open questions / next steps

- The running proxy still has the old code until it is restarted.
- Experiment analysis: exclude (or flag) the agent requests after each `kind: "compaction"` line logged before the restart. Those turns were routed on a stale answer and have no classifier fields.
