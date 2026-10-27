# 12 — Low-risk repository cleanup

**Date:** 2026-10-26
**Previous:** [report 11](11_progress_report.md) (freshness and removal audit)
**Related:** [report 10](10_progress_report.md) (existing dashboard work)

## What we did

Applied the user-approved cleanup from the audit without changing routing or classifier behavior:

1. Removed `.claude/settings.json` and `.claude/hooks/check-gstack.sh`. The settings file contained only the obsolete gstack gate; no unrelated settings were discarded.
2. Removed the unused `ASR_CLIENT_KEY` entry from the eval's isolated environment and unconsumed `StreamSummary.model` / `eventTypes` bookkeeping from `src/sse.ts` and `src/upstream.ts`.
3. Removed the parser test's instrumentation-only event-count assertion, preserving every test case and substantive usage, response-ID, error, and reasoning-ID assertions. Renamed heuristic-scorer exception tests/comments so they no longer imply actual classifier-rejection coverage.
4. Refreshed the handoff, labeled original specs as historical/superseded where needed, and clarified eval classifier-off and optional-follow-up behavior in `eval/README.md`. Historical progress reports and original design reasoning were preserved.

The pre-existing changes to `README.md`, `src/cli.ts`, dashboard source/tests, and report 10 were retained during cleanup. The subsequently completed idle-timeline fix is documented in [report 13](13_progress_report.md). Report 11 also records dashboard generic and temporary-directory portability findings, which remain open.

## Issues encountered

- No cleanup-related test or type errors.
- Fail-open tests still print their intentionally injected exceptions; these are expected and the tests pass.
- The mock eval prints a failing task and a small dollar figure. The mock intentionally does not fix the task; its token usage and dollar figure are synthetic, not paid provider spend. OpenCode exited successfully and the proxy logged no request errors.

## Decisions and rationale

| Decision | Alternatives considered | Rationale |
|---|---|---|
| Remove the gstack-only settings file and hook together. | Keep an empty settings file or retain the gate. | The latest prior commit explicitly removed the gstack requirement; neither file has any remaining purpose. |
| Remove unused SSE summary fields, not the parser or tests. | Retain speculative diagnostics or delete investigation-era code broadly. | No production consumer uses these fields; usage, errors, response identity, and reasoning ownership remain necessary and tested. |
| Update current handoff and add spec status notices. | Rewrite historical specifications and progress reports. | Readers need current setup and implementation pointers, while the original decisions and planned experiments remain traceable. |
| Defer behavioral bug fixes and editor-theme removal. | Include all audit findings in this cleanup. | Routing/classifier changes could affect the ongoing experiment; the idle timeline and replay bugs are distinct follow-ups. Editor colors are a preference, not proven dead code. |

## Results

- `TMPDIR=/tmp/opencode bun test`: **70 passed, 0 failed** across 8 files; **551 assertions**. The four-assertion reduction comes from removing one event-count assertion executed at four chunk sizes; no test cases were deleted.
- `bun run typecheck`: passed.
- `git diff --check`: passed.
- `TMPDIR=/tmp/opencode bun eval/run.ts self-check`: all **17** local fixtures fail as given and pass with the reference solution.
- `TMPDIR=/tmp/opencode bun eval/run.ts run --mock --tasks greeting-typo --configs auto --timeout 30`: OpenCode exit **0**, two proxy requests, no request errors or timeout. Output: `eval/runs/2026-10-27T00-20-11/` (gitignored; UTC timestamp).
- Source/config reference checks found no remaining consumers of the removed hook, environment entry, or SSE summary fields. All relative Markdown file-link targets exist (remote URLs and fragments not checked).

No paid run, service restart, experiment change, commit, or push was performed.

## Open questions / next steps

1. Fix the idle dashboard timeline with a clock-controlled frontend regression test; it can currently stop advancing when request data is unchanged.
2. Address the dashboard WIP portability/generic findings and behavioral edge cases recorded in report 11 as separate work, especially classifier answer parsing and forward-auth credentials. Obtain approval before changing the running experiment's behavior.
3. Experiment analysis remains pending; this cleanup did not inspect or alter the user's live data.
