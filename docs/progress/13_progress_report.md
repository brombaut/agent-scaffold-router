# 13 — Live timeline advances during idle periods

**Date:** 2026-10-27 (UTC)
**Previous:** [report 12](12_progress_report.md)
**Related:** [report 10](10_progress_report.md) (timeline implementation)

## What we did

Fixed the idle timeline issue noted in report 12 and reported by the user. `src/dashboard/index.html` now advances existing SVG markers on a separate 100 ms clock, regardless of whether new log entries arrive. Axis labels advance with seconds, expired markers leave the window, and counts/empty state update automatically. Updated `README.md` and added a clock-controlled behavioral regression test in `test/dashboard.test.ts`.

## Issues encountered

The existing refresh signature deliberately ignores `generatedAt` to avoid rebuilding tables when nothing changes. The timeline incorrectly shared that optimization, freezing its time axis between log updates.

## Decisions and rationale

- Keep polling and clock movement separate: new records still arrive via the one-second API poll, while the rolling window advances independently.
- Move existing SVG nodes rather than rebuilding the chart each tick. This preserves marker flashes and keyboard focus. Consume a new marker's flash flag when first rendered so changing views or resizing does not replay it.
- Anchor elapsed time to the latest server timestamp using `performance.now()`. The clock keeps advancing between successful polls and avoids dependence on the browser's wall-clock setting.
- Skip movement while the document or Overview is hidden; resume at current time when visible. Existing stale-data notices remain in place if fetching fails.

## Results

- `bun test`: **71 passed, 0 failed**, 562 assertions.
- `bun run typecheck`: passed.
- Regression test advances time without changing data and verifies marker movement, ticking labels, node preservation, expiry, counts, and empty state.
- No proxy restart or routing/experiment changes. This is a frontend-only fix; reload the dashboard to activate it.

## Open questions / next steps

Check the timeline during a quiet period in the browser. No browser-based visual validation was performed in this session.
