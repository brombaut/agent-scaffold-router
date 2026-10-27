# 10 — Live routing timeline added to the local dashboard

**Date:** 2026-10-26
**Previous:** [report 09](09_progress_report.md) (classifier wired into the router; everyday-use experiment started)
**Context:** The dashboard prototype was already present as uncommitted work at the start of this session. This report covers its review and the live-timeline feature added after the user requested it.

## What we did

1. Reviewed the dashboard UI, data aggregation, local server, and existing dashboard tests. The existing dashboard suite passed before changes (11 tests).
2. Added a rolling live-routing timeline to the Overview in `src/dashboard/index.html`:
   - One marker per completed model call, including tier changes within a user message.
   - 5-, 15-, and 60-minute windows; 15 minutes is the default.
   - Small and Strong markers use their tier colors; newly observed calls briefly pulse. Reduced-motion preferences disable the pulse.
   - The timeline labels calls by local time and shows a count by tier. It does not display prompt previews.
3. Added `liveRequests` to `src/dashboard/data.ts`, containing the last hour of compact request fields for the timeline, excluding future-dated records. Updated `README.md` and `test/dashboard.test.ts`.
4. Verified all tests and typechecking.

## Issues encountered

- The first rolling-hour test revealed that future-dated records were included in the API timeline data. Added an upper timestamp bound; the frontend also clamps events to the server's generated time.
- No browser-based visual review was available in this run.

## Decisions and rationale

| Decision | Alternatives | Why |
|---|---|---|
| Show every completed model call. | One marker per user message. | A single message can produce calls at multiple tiers; showing every call exposes those switches. |
| Default to 15 minutes, with 5- and 60-minute options. | Fixed window or a separate duration control with more options. | Gives a useful default while keeping short bursts and longer activity easy to inspect. |
| Include only compact request fields in timeline data. | Reuse the full recent-request ledger records. | The chart needs timestamp, tier, reason, status, and ID; prompt previews and other unrelated fields are not needed. |
| Pulse only newly observed calls while Overview is active. | Animate every redraw or replay missed animations on view change. | Avoids repeatedly flashing old markers during one-second refreshes or surprising flashes when returning to Overview. |

## Results

- `bun test`: **70 passed, 0 failed** across 8 files.
- `bun run typecheck`: passed.
- `git diff --check`: passed.

## Open questions / next steps

1. Open the dashboard during active routing and check visual density, especially during bursts of many model calls.
2. If a one-hour window can contain an unusually large number of calls, consider limiting or aggregating markers; the current timeline returns all valid calls in that hour.
