# 14 — Instant routing timeline popups

**Date:** 2026-10-27 (UTC)
**Previous:** [report 13](13_progress_report.md)

## What we did

Replaced the live timeline's delayed native SVG title tooltip with an immediate, styled popup in `src/dashboard/index.html`. Hovering or keyboard-focusing a dot displays its tier, upstream model, readable and exact routing reason, conversation label, message number, call cost, latency, HTTP status, and any recorded error. Expanded the rolling-hour `liveRequests` projection in `src/dashboard/data.ts` to supply these fields independently of the recent-80-call ledger. Updated `README.md` and `test/dashboard.test.ts`.

## Issues encountered

- The previous native SVG `title` relied on browser-controlled hover timing and could not provide the requested immediate popup.
- Timeline dots move every 100 ms and are rebuilt when data changes. Popup positioning and selection therefore need to follow the current marker rather than retain a detached DOM node.
- No browser executable was available for visual validation. Behavioral tests execute the production timeline and popup functions against a small DOM stand-in; actual layout and pointer hit testing remain unverified in a browser.

## Decisions and rationale

- Use one shared HTML tooltip, populated synchronously on pointer entry or keyboard focus. This adds no dependencies, network requests, or model calls.
- Keep selection by request ID across redraws, update placement with the existing timeline clock, and clamp the popup within the viewport. Hide it when its dot expires, the view changes, or the page becomes hidden. Escape dismisses it, and moving directly onto the popup keeps it readable.
- Preserve logged text using DOM text content, not HTML. Do not add prompt previews or raw classifier responses to the live-call payload. Reuse the existing conversation labels.
- Label unavailable model/message/cost data explicitly. Describe the price as call cost excluding selection fees, consistent with the ledger and spending totals.
- Limit changes to the read-only dashboard and its documentation/tests; do not alter routing, classifier behavior, experiment assignment, or the running proxy.

## Results

- `bun test`: **72 passed, 0 failed**, 596 assertions across 8 files.
- `bun run typecheck`: passed.
- `git diff --check`: passed.
- Regression coverage includes synchronous hover/focus display, dismissal, viewport clamping, hostile text, missing fields, redraw retention, expiry, and the live payload's allowed fields. The existing idle-timeline regression still passes.
- No paid calls, service restarts, commits, or pushes.

## Open questions / next steps

Restart only the separate dashboard process (`bun src/cli.ts dashboard`) to load the expanded API projection, reload the page, and hover a live dot to visually verify the popup. The routing proxy does not need a restart.
