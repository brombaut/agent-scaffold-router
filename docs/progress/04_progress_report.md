# 04 — Child #4: packaging, README, CI; v1 merged

**Date:** 2026-10-06
**Phase:** v1 (children #1–#4) complete and merged to `main`
**Previous:** [03 — Routing core, decision log, cost and `report`](03_progress_report.md)

## What we did

- **Packaging:** `package.json` now has `bin`, `files` (`src`, `examples`, `README.md`), `engines` and scripts (`serve`, `report`, `test`, `typecheck`). `src/cli.ts` is executable. `bun pm pack` produces an 18 KB tarball, and installing that tarball gives a working `agent-scaffold-router` CLI (`--help` and `report` both checked).
- **README:** setup (Zen key, proxy, the OpenCode config from [`examples/opencode.jsonc`](../../examples/opencode.jsonc)), the virtual models, how routing works (heuristic table, escalation, overrides, fail-open, title and compaction, reasoning ownership), configuration, logs and `report`, caveats, and development.
- **CI:** [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs `bun install --frozen-lockfile`, `tsc --noEmit` and `bun test` on every push and pull request. The first run passed in 14 s (run 37094503617).
- **Merge:** `feat/01-passthrough-proxy` → `feat/02-routing-core` → `feat/04-packaging` were stacked in a straight line, so `main` fast-forwarded to them (commits `b62fd39`, `80c2093`, `890cdf7`).

## Decisions and rationale

| Decision | Why |
|---|---|
| **No license for now; `"private": true` in `package.json`** | Your call. `private` prevents an accidental `npm publish` while the package is unpublished. |
| **Don't publish to npm yet** | Your call. The README tells people to run from a checkout, with `bunx` noted as "once published". |
| **No separate PR review for the three branches** | Solo project, CI green, and each branch was already covered by tests and a progress report. |

## Results

All v1 acceptance criteria from the [spec](../specs/001-epic-agent-scaffold-router.md) pass, with one exception for criterion 1:

| # | Status |
|---|---|
| 1 | ✓ `bun src/cli.ts serve` (and the packed tarball's CLI); `bunx` waits on publishing |
| 2–9 | ✓ (see [report 03](03_progress_report.md)) |
| 10 | ✓ CI green on GitHub Actions |

Live spend for the whole of v1: **$0.51** of the $1 budget.

## Open questions / next steps

Carried over from report 03:
- Escalation false positives on source files that mention "error".
- Whether compaction should go to strong.
- The OpenCode `run` hang (workaround: `--print-logs`).
- How approximate the all-strong counterfactual is.

Next is child #5, the evaluation harness: auto vs strong vs weak on a task set through headless `opencode run`.
