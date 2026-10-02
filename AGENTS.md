# scaffold_router

Research, design and build an "agent scaffold router": a router that decides
per request/turn/session whether a coding-agent task needs a strong model or a
cheaper, faster one. Target harness: OpenCode first, Claude Code later.

## Progress reports (REQUIRED)

We keep a running record of how this project is designed and built in
`docs/progress/`, as numbered files: `00_progress_report.md`,
`01_progress_report.md`, `02_progress_report.md`, … (zero-padded, incrementing).

- **When to write one:** at meaningful milestones, e.g. after finishing a
  research phase, a spec, a working prototype, an eval run, a significant
  pivot, or when the user asks. Don't write one for trivial changes. If you're
  unsure whether enough has happened, ask the user.
- **Never edit past reports** except to fix factual errors. New information
  goes in the next report, and that report links back to earlier ones where
  relevant.
- **Each report covers what happened since the previous one:**
  - **What we did:** work completed, experiments run, code written.
  - **Issues encountered:** what broke, what was surprising, dead ends.
  - **Decisions and rationale:** what was decided, the alternatives
    considered, and *why*. This is the most important section.
  - **Results:** numbers, benchmarks, observations (if any).
  - **Open questions / next steps.**
- Include the date, and cite sources (links, file paths, commits) so the
  reasoning can be traced later.
