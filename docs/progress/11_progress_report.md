# 11 — Repository freshness and cleanup audit

**Date:** 2026-10-26
**Previous:** [report 10](10_progress_report.md) (dashboard timeline; already present as uncommitted work when this audit began)

## What we did

Reviewed current documentation, development configuration, source/test references, and the existing working tree for stale or removable material. This was an audit, not a cleanup: existing dashboard changes were preserved, and no runtime code, tests, configuration, or existing documentation was changed.

Validation performed without provider calls:

- `bun test`: **70 passed, 0 failed**, across 8 files (555 assertions). The printed injected exceptions are expected fail-open test output.
- `bun run typecheck`: passed.
- `bun test --coverage`: 70 passed again; instrumented files show 93.81% line / 87.56% function coverage. This is not whole-repository coverage: unimported CLI/eval entry points and browser-side dashboard JavaScript are not represented. `src/auth.ts` (29.41% lines) and config-loading functions are notable coverage gaps, not deletion candidates.
- `TMPDIR=/tmp/opencode bun eval/run.ts self-check`: all **17** local tasks fail as given and pass with their reference solutions.
- Relative Markdown file links in tracked and nonignored untracked Markdown: no missing local targets (URL and fragment validation excluded).
- `git diff --check`: passed.

## Issues encountered

The working tree already contained changes to `README.md` and `src/cli.ts`, plus untracked `src/dashboard/`, `test/dashboard.test.ts`, and report 10. These were treated as work in progress, not dead files. The current passing test count includes that work.

## Findings: documentation and development configuration

1. **Leftover gstack requirement.** Commit `172ff52` removed the gstack/GBrain instructions from `CLAUDE.md`, but `.claude/settings.json:5–9` still hooks every Claude Code `Skill` invocation through `.claude/hooks/check-gstack.sh`. That script denies skill use when gstack is not installed, claiming it is required for the repository (`:13–26`). Recommend removing the hook registration and its script together, unless the user explicitly wants to restore that dependency. A dry run with `HOME=/tmp/opencode/asr-audit-no-gstack GSTACK_ROOT= bash .claude/hooks/check-gstack.sh` reproduced the denial (exit 2) without changing files. This is a recommendation only; no files were removed.
2. **Stale operational handoff.** `docs/HANDOFF.md:5,23,63,67` still stops at report 09, reserves report 10 for experiment analysis, and says there are 58 tests. Report 10 now exists for dashboard work and the working tree has 70 tests. Its code map omits the dashboard. Refresh the current handoff; do not rewrite historical reports. The live service/config statements were not reverified on the user's machine.
3. **Specifications need historical/status labels.** Spec 001 still says DRAFT/not filed and includes an obsolete provider config (`docs/specs/001-epic-agent-scaffold-router.md:3,210–228` versus `examples/opencode.jsonc`). Spec 003 says nothing is built and proposes `policy.turnStart` (`docs/specs/003-turn-start-decision.md:4,100`), while the implemented setting is `policy.classifier` (`src/config.ts:28–33,81`; reports 08–09 document implementation and results). Spec 002 still says its paid run awaits approval (`docs/specs/002-polyglot-eval.md:4`), although report 07 records completion. Preserve design history, but add concise status/supersession notices directing readers to current setup and results.
4. **Eval README has two misleading omissions.** `eval/README.md:33` says the user's router configuration is applied but does not mention that `eval/run.ts:278` explicitly forces the classifier off. Users cannot evaluate their configured classifier through this runner as written. `eval/README.md:51` also says there is no second attempt; that is only the default, since `--followup` is implemented and documented at `:28` (`eval/run.ts:358–389`). Clarify both rather than removing the runner.
5. **Optional editor-only cleanup.** `.vscode/settings.json` contains only Peacock/window colors. It is removable from version control if the user does not want a shared editor theme; it is not a runtime dependency or a confirmed defect.

## Findings: narrow code/test cleanup

1. **Unused legacy environment entry:** `eval/run.ts:326` still sets `ASR_CLIENT_KEY`, but `examples/opencode.jsonc:15–16` now uses the literal `unused`. Report 09 explicitly records this migration. Remove only that environment entry, retaining the isolated environment.
2. **Unused SSE summary bookkeeping:** `StreamSummary.model` and `eventTypes` in `src/sse.ts:25–27,47–49,87–91` have no production consumer in `src/upstream.ts:120–144`; the JSON-response path also fills the unused model field. `eventTypes` is asserted only by `test/inspect.test.ts:60`. These fields and their instrumentation-only assertion can be removed if no diagnostic API is planned. Keep the parser and its substantive tests.
3. **Unused generic:** `grouped<T>` in `src/dashboard/data.ts:76` does not use `T`. Remove `<T>` only. The source/test audit's stricter unused-local/parameter TypeScript check reported this parameter, not an unused dependency or abandoned module.
4. **Stale test terminology:** `test/router.test.ts:221–225`, `test/routing-integration.test.ts:81–85`, and `src/router/policy.ts:31` describe an injected heuristic `score` failure as a classifier failure. Rename descriptions/comments; do not remove the tests or mistake them for actual `classify`-rejection coverage.

## Findings: bugs and missing regression coverage, not removal candidates

1. **Dashboard tests assume a harness-specific temporary directory.** `test/dashboard.test.ts:38–40` calls `mkdtempSync` below `/tmp/opencode`, whose parent must already exist. That directory is provisioned here, but `.github/workflows/ci.yml:9–17` does not create it on a fresh Ubuntu runner. Use an existing system temporary directory or explicitly create the parent. The green local run does not establish CI portability.
2. **Live timeline can stop advancing during idle periods.** `src/dashboard/index.html:927–929` excludes `generatedAt` from its redraw signature, while the positions and selected-window filtering depend on it (`:507–518`). If request data is unchanged, time advances without a redraw. The source/test audit reproduced two refreshes with different times but only one redraw in an in-memory execution. Add a clock-controlled frontend test for movement and expiry without new traffic; refresh the time-dependent timeline independently of whole-page change detection.
3. **String-input override tokens are not stripped.** `src/responses/items.ts:22–25` allocates a temporary message for string input. `src/router/policy.ts:70–72` strips tokens from that wrapper, not the forwarded `body.input`. Parent-session in-memory reproductions with an agent tool list selected the requested tier for both `!strong` and `!weak`, but left both tokens in the upstream string. Existing override tests use arrays; add string-form rewrite assertions.
4. **Classifier edge cases need separate tests.** `src/router/classifier.ts:58` accepts the first occurrence of either tier anywhere in an answer. Parent-session reproduction of `Not weak; use strong.` returned Weak, contrary to the unclear-answer fail-open contract at `:23–25`. Separately, `src/server.ts:86–88` provides the independently resolved key to classifier calls, while forward-auth agent requests use the client's header (`src/upstream.ts:66–67`); with no local key, classifier calls send an empty bearer token. Add strict-answer and forward-auth integration tests. Changing classifier behavior during the everyday experiment requires the user's explicit approval; this audit made no such change.
5. **Chaining and replay need honest missing-state behavior.** For `previous_response_id`, memory retains session identity and turn index, not prior first-message text/tier (`src/server.ts:36–42`, `src/responses/items.ts:62–85`). Session-granularity routing can therefore rescore a delta as the initial message (`src/router/policy.ts:82–84`). This affects delta-chaining clients, not OpenCode's documented full-history requests. Add a chained multi-request regression or narrow the supported contract. Separately, `eval/replay.ts:42–48` emits a “current heuristic” row even when Auto outcomes/start tiers are absent, silently substituting Weak. A parent-session synthetic Weak/Strong-only replay reproduced that misleading row. Omit or explicitly mark the unavailable comparison; test missing Auto data, null tiers, incomplete pairs, and repetitions.

These are targeted follow-up fixes. They do not establish that any of the affected modules should be deleted. The audit found no orphaned production module, unused package dependency, or skipped/focused test that warrants broad removal.

## Decisions and rationale

- **Recommend changes before deleting.** The user asked for a freshness/removability check, not broad removal. Unused-looking files alone are insufficient evidence that they should be deleted.
- **Keep progress reports and original design reasoning.** `AGENTS.md` requires historical reports to remain immutable except for factual corrections. Historical plans are valuable, but their current-looking status and examples should not misdirect setup.
- **Keep the local eval tasks.** Their ability to distinguish model tiers was weak in earlier experiments, but all 17 still provide valid fixture/reference checks. Poor benchmark discrimination is not the same as dead or broken test data.
- **No paid evaluation or service restart.** Neither was necessary to establish repository freshness, and the everyday experiment must remain undisturbed.

## Results

The local baseline is green, but the audit found a dashboard-test portability risk and uncovered behavioral edge cases not represented by that suite. Confirmed removal opportunities are small: the obsolete gstack gate, one legacy environment entry, unused SSE summary bookkeeping, and one generic parameter. No whole runtime subsystem or test suite was shown to be obsolete.

## Open questions / next steps

1. Apply the low-risk cleanup: remove the obsolete gstack gate and refresh current documentation/status labels, preserving historical content and existing dashboard work.
2. Treat optional editor-theme removal as a preference decision, not required maintenance.
