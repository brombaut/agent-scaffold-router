# 15 — Hoverable line charts and a leaner dashboard

**Date:** 2026-11-06
**Previous:** [report 14](14_progress_report.md)
**Issue:** [#5](https://github.com/brombaut/agent-scaffold-router/issues/5)

## What we did

- Rewrote the shared `chart()` in `src/dashboard/index.html` for the three daily line charts (cumulative spend, calls per day, spend over time). Each chart now draws a light area fill and four gridlines. Hovering anywhere on it snaps to the nearest day, draws a dashed guide line with a dot on each series, and shows one tooltip with every series' value for that day. Charts are focusable with Tab; Left/Right move between days. The hovered day survives the 1 s refresh.
- Removed the per-point native SVG `title`s, which needed a precise hover on a 2.5 px dot and appeared after a browser delay.
- Cut dashboard text: removed every view intro paragraph, panel subtitles and footnotes, the overview explanation and duplicate legend, and the "measures agreement, not quality" captions. Headings are now short ("Cumulative spend", "Calls per day", "AI vs rules"). The latency/header-timing caveat moved into the existing "HTTP statuses & measurement notes" disclosure, so no caveat was lost. Pricing gaps still show; the "all calls priced" confirmation no longer does.
- Removed six dead CSS rules that recoloured legacy chart hex colours.
- Added a regression test that executes the production chart functions against a DOM stand-in (hover values, keyboard stepping and clamping, refresh retention, dismissal, empty chart). Updated `README.md`.

## Issues encountered

- No browser is available on this machine (`chrome-devtools-axi` cannot attach; same as report 14), so layout and pointer behaviour were not checked visually. The served page was fetched from a temporary dashboard on port 8799 and its script parsed; the 8788 dashboard and the proxy were not touched.

## Decisions and rationale

- **No chart library.** The existing hand-rolled SVG chart needed only nearest-point hover; a library would add a dependency and a CDN or vendoring question for three small charts.
- **One tooltip per chart showing all series**, rather than per-line tooltips, because the useful comparison is actual vs all-Strong (or Small vs Strong) on the same day.
- **Kept daily buckets.** The "Last 24 hours" range still gives one point; hourly buckets would need a `data.ts` change. Deferred until it's wanted.
- Dashboard-only change: routing, classifier and experiment behaviour are untouched.

## Results

- `bun test`: **73 passed, 0 failed**. `bun run typecheck` and `git diff --check` passed.
- No paid calls, no service restarts, no commits.

## Open questions / next steps

- Restart the 8788 dashboard (`bun src/cli.ts dashboard`) and check hover and layout in a real browser.
- Hourly buckets for short ranges if the 24 h view matters.
