# 09 — Classifier wired into the router; everyday-use experiment started

**Date:** 2026-10-19
**Phase:** router improvements after the eval (child #5), on `main`
**Previous:** [report 08](08_progress_report.md) (classifier negative result on Polyglot)
**Plan:** [spec 003](../specs/003-turn-start-decision.md)

## What we did

1. **Wired the classifier into the proxy** (commit `d6868d6`). New config `policy.classifier`:
   - `mode`: `off` (default), `shadow`, `on` or `experiment`; `model`: the tier that classifies (default `strong`); `timeoutMs` (default 10 000).
   - One classifier call per user turn, keyed `sessionKey#turnIndex`, so every request in the turn shares the answer. Only agent requests to `router/auto` without a `!strong`/`!weak` override are classified.
   - On a follow-up turn the classifier is told which model handled the previous turn (`[Follow-up message in an ongoing session. The previous turn was handled by the small/large model.]`).
   - **`on`** awaits the classifier and routes by it (`reason: classifier:<tier>`). Escalation still applies on weak.
   - **`shadow`** routes by the keyword heuristic. The classifier runs in parallel and its result is merged into the log line when the response finishes, so the client never waits.
   - **`experiment`** puts each session in `on` or `shadow` by the parity of sha256(sessionKey).
   - Turn-start log lines gain `arm`, `classifierTier`, `heuristicTier`, `classifierRaw`, `classifierCostUSD` and `turnPreview` (first 500 characters of the user message). `report` adds the classifier's cost to session cost.
   - Tests: `test/classifier-routing.test.ts` (on, shadow, off, override). 58 tests pass; typecheck clean.
2. **Made everyday use frictionless.**
   - `examples/opencode.jsonc` now sets `"model": "router/auto"` as the default and uses a placeholder `apiKey: "unused"` instead of requiring the `ASR_CLIENT_KEY` env var (checked against the mock upstream).
   - `examples/agent-scaffold-router.service`: a systemd user service running `bun src/cli.ts serve` from the checkout.
3. **Installed it on the user's machine** for the experiment: service enabled and running, OpenCode's global config replaced with the example (old one at `~/.config/opencode/opencode.jsonc.bak`), and `~/.config/agent-scaffold-router/config.json` set to `{"policy":{"classifier":{"mode":"experiment"}}}`. Health check and `/v1/models` verified; no live request made.
4. The eval runner forces `classifier.mode: "off"`, so eval numbers stay comparable with reports 06–08.

No spend this period. Total live eval spend stays at **$4.72**.

## Issues encountered

- None blocking. The first real OpenCode session through the service is also the first live test of the wiring.

## Decisions and rationale

| Decision | Alternatives | Why |
|---|---|---|
| Randomize per session (`experiment`) instead of the user's plan of classifier days then off days (user agreed, 2026-10-18). | On/off by day | Both arms see the same mix of work, the user never has to toggle anything, and shadow sessions still record what the classifier would have picked. |
| Shadow mode never delays the request. | Await the classifier in both arms | Shadow should cost the user nothing but money (~$0.002 per turn). |
| Strong as the default classifier model. | Weak | Report 08: weak said weak on 56/60. Strong at least varied its answer. |
| Log the first 500 characters of each user message, locally only. | Log nothing; log the full message | Pushback ("that's wrong", pasted errors) is the main outcome signal for everyday work, and it's only visible in the text. 500 chars is enough to spot it. |
| Per-turn routing is kept, not per-session. | Switch the default to `granularity: "session"` | The experiment will show how often turns flip tiers, which is what the cache-loss question needs. |

## Results

None yet. The experiment is collecting data.

## Open questions / next steps

1. **Analyze the experiment** once there are ~30+ sessions: use log lines with an `arm` field; compare arms on cost, overrides, pushback in the next `turnPreview`, and tier flips within a session; check how often classifier and heuristic disagree.
2. **A `--followup` Polyglot run** (from report 08), to measure pushback and per-turn vs per-session routing. Needs a go and a budget.
3. The `InterruptError` exits from report 07, if they recur.
