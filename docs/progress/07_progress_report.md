# 07 — Harder tasks, hidden tests, and the move to Aider Polyglot

**Date:** 2026-10-17 (covers 2026-10-14 to 2026-10-17)
**Phase:** Child #5 (evaluation harness) of the [epic spec](../specs/001-epic-agent-scaffold-router.md), on `main`
**Previous:** [report 06](06_progress_report.md) (harness and first live results)
**Plan:** [spec 002 — evaluate the router on Aider Polyglot's exercises](../specs/002-polyglot-eval.md)

## What we did

1. **Added five harder tasks** (commit `9f0de49`): `ot-transform`, `json-patch`, `incremental-build`, `async-pool` and `monthly-recurrence`. Each has several interacting bugs, `incremental-build` spans three files, and `ot-transform` is checked by a seeded randomized convergence test.
2. **Ran weak vs strong on them** (2026-10-15): 5 tasks × 2 configs × 2 reps, $0.61. Output: `eval/runs/2026-10-15T01-27-50/`.
3. **Added `--hide-tests`** (commit `2683536`). The agent's workspace has no `test/` dir, and the check puts it back. Tasks whose prompt mentions the tests got a `hiddenPrompt`, and behaviour the tests require but nothing stated was added to the source doc comments.
4. **Ran weak on all 17 tasks with hidden tests** (2026-10-16): 2 reps, $0.09. Output: `eval/runs/2026-10-16T10-27-03/`.
5. **Planned an eval on Aider Polyglot** (spec 002, commits `0d8bbd0` → `908f0f1`). The plan went through four revisions; see the decisions below.
6. **Built the Polyglot suite** (2026-10-17):
   - `eval/polyglot.sh` clones `Aider-AI/polyglot-benchmark` at `7e0611e77b54` into `eval/polyglot/` (gitignored) and builds the `asr-polyglot` Docker image.
   - `eval/polyglot.Dockerfile` contains the Node 20 and Python 3.11 parts of Aider's `benchmark/Dockerfile`, with the same pinned jest/babel packages and pytest.
   - `eval/polyglot-subset.txt` holds the 60 exercises: 35 JS and 25 Python, drawn once with a seeded shuffle.
   - `eval/run.ts`:
     - New option `--suite tasks|polyglot` for `list`, `self-check` and `run`.
     - `Task` is now generic. It has `repo`, `hide`, `protect`, `solution` and `language` fields.
     - A loader builds each Polyglot exercise as Aider's `benchmark/benchmark.py` does (`Aider-AI/aider@38d4341e5976`).
     - The check runs in Docker.
     - The summary has a language column, and per-language solved columns when a run covers more than one language.
7. **Ran the free checks** on the Polyglot suite. See Results.

Live spend so far: $1.24 before this report, plus $0.69, for **$1.93** in total.

## Issues encountered

- **The harder tasks still didn't separate the tiers.** With visible tests, weak solved 9 of 10 runs. The weak model iterates against the test file until it passes, so the tests do much of the work for it.
- **Hidden tests didn't separate them either.** Weak solved 19 of 22 hard runs. Two of the three failures (`csv-parser` 0/2, `json-patch` 1/2) were gaps in our own task specs, where the tests required behaviour the prompt and doc comments didn't state. They were not model errors.
- **Writing hard tasks ourselves didn't work.** Each round, the weak model solved nearly everything, and our own tasks turned out to have spec gaps.
- **`javascript/ledger` passes as given.** It is Exercism's refactoring exercise, where the stub already works and the task is to clean it up. `self-check` therefore reports 59/60 for the Polyglot suite, with ledger as the FAIL. It stays in the subset (see decisions).
- **Hiding `.docs/` was not in spec 002**, which said to hide `.meta/` and the tests. Aider's harness also hides `.docs/`, and its text is already in the prompt, so we hide it too.

## Decisions and rationale

| Decision | Alternatives | Why |
|---|---|---|
| Hide the tests from the agent (`--hide-tests`, 2026-10-16). | Keep them visible | With visible tests, weak solved 26 of 28 hard runs by iterating against them, so the eval measured test-driven persistence, not model strength. |
| **Stop writing our own tasks and use Aider Polyglot** (2026-10-16). | Write more and harder tasks; SWE-bench | Three rounds of our tasks couldn't separate weak from strong. Polyglot's 225 exercises were picked *because* models fail them, they come with tests and reference solutions, and they need no repo setup, unlike SWE-bench. |
| Compare our three configs only against each other, not against Aider's leaderboard. | Reproduce Aider's protocol to compare with published scores | The question is whether `auto` gets near `strong`'s quality at closer to `weak`'s cost. Our scores come from our own OpenCode harness, so they aren't comparable to Aider's anyway. |
| Python and JS only. | All six languages | Most exercises (83), tests run in seconds with no compile step, and the Docker image needs only two toolchains. Other languages can be added later without design changes. |
| **One fixed subset of 60 exercises** (35 JS, 25 Python, in proportion), shared by all three configs, seeded and committed. | All 83 exercises; a different subset per config; hand-picked exercises | All 83 for 3 configs didn't fit the budget. A shared set makes the configs directly comparable. A seeded draw avoids cherry-picking and is reproducible. |
| Eval budget raised to **$10** for the Polyglot run (user, 2026-10-16). | Keep $5 | The estimate is about $8.30. `--budget 10` keeps the proxy-side hard stop. |
| **One try per exercise** (user, 2026-10-16). | Two tries with test output, as Aider does | We only compare configs against each other, so matching Aider's protocol buys nothing. A scripted retry that pastes test output isn't a realistic second turn. One try is cheaper and needs less code. |
| Read exercises straight from a clone pinned at `7e0611e77b54`, not copied into `eval/tasks/`. | Convert and commit them | Keeps the benchmark unmodified and the repo small, and the pinned SHA keeps it reproducible. |
| The prompt is the exercise's `.docs` (introduction, instructions, append) plus Aider's addendum, verbatim. | Write our own prompt | Copying Aider's wording means we don't tune prompts. |
| Hide `.meta/`, `.docs/` and the test files during the agent's turn. | Hide only the tests | `.meta/` holds the reference solution. `.docs/` is hidden to match Aider, and its text is in the prompt anyway. |
| The agent runs on the host, and only the check runs in Docker (offline, as the user's uid, `timeout 180` inside the container). | Run OpenCode in the container too | Keeps the proxy, auth and isolated HOME unchanged. `timeout` runs inside the container because killing `docker run` would leave the container running. The uid keeps files in the workspace removable. |
| A small image with only the Node and Python parts of Aider's Dockerfile. jest is pinned to 29.7.0 (Aider leaves it unpinned). | Aider's full image | Builds fast with no Go, Rust, Java, C++ or Aider itself. The pin keeps the check reproducible. |
| JS check inlines Aider's `npm-test.sh` (symlink `node_modules`, `xtest(` → `test(`, `npm run test`). Python check is `pytest`. | Copy the script into the image | Same commands with one fewer file. |
| **Keep `javascript/ledger` in the subset** (2026-10-17). | Swap in the next JS exercise from the draw | It's part of the benchmark and affects all configs equally. A config can only lose it by breaking working code. Swapping it would break the "drawn once, never edited" rule. |
| Defer the router fixes from report 06 (subagent routing, escalation on file contents, give-up detection) until the Polyglot results are in. | Fix them first | The results will show which of them actually cost quality or money. |

## Results

### Our own tasks (before the switch)

| round | output dir | weak, hard runs | strong, hard runs |
|---|---|---|---|
| 5 harder tasks, visible tests, 2 reps | `eval/runs/2026-10-15T01-27-50/` | 9/10, $0.0047/solved | 10/10, $0.056/solved |
| all 17 tasks, hidden tests, 2 reps | `eval/runs/2026-10-16T10-27-03/` | 19/22 (easy: 12/12) | not run |

Strong cost about 12× as much per solved task as weak, with essentially the same quality.

### Polyglot free checks (2026-10-17)

- **`self-check --suite tasks`:** 17/17 ok. The generic `Task` caused no regressions.
- **`self-check --suite polyglot`:** 59/60 ok in about 1 minute. Every stub fails and every reference solution passes, except `javascript/ledger` (above).
- **`run --mock --suite polyglot`:** 4 exercises (2 JS, 2 Python) × weak/auto. The pipeline ran end to end, and the checks reported real jest and pytest failures.
- **Prompt check:** a captured request (`--capture`) showed the docs followed by Aider's addendum naming the solution file (`zipper.py`).

### Polyglot paid run

Run on 2026-10-17 with the user's go: weak, auto and strong on the 60-exercise subset, 1 rep, 1 try, `--budget 10`.

- Run dir: `eval/runs/2026-10-17T23-33-02/` (gitignored)
- 180 runs in 84 minutes. Spend: **$2.67**, about a third of the $8.30 estimate. Total live eval spend is now $4.60.

| config | solved | javascript | python | cost | $/solved | median wall | % strong reqs | escalated | cut short |
|---|---|---|---|---|---|---|---|---|---|
| strong | **48/60 (80%)** | 26/35 | 22/25 | $1.87 | $0.039 | 30s | 86% | 0 | 0 |
| auto | **28/60 (47%)** | 12/35 | 16/25 | $0.66 | $0.024 | 25s | 26% | 0 | 0 |
| weak | **20/60 (33%)** | 9/35 | 11/25 | $0.14 | $0.007 | 21s | 0% | 0 | 0 |

Observations:

- **Polyglot separates the tiers.** Strong solved 80% and weak 33%, after our own tasks showed no gap at all. This benchmark is usable for routing decisions.
- **Auto lands between the two:** 47% quality at 35% of strong's cost. It recovers 8 of the 28 solves weak misses, which is about 29% of the gap.
- **Auto's quality comes entirely from the turn-start decision.**

  | auto, by start tier | runs | solved | escalated |
  |---|---|---|---|
  | started on strong (keyword hit) | 18 | 14 (78%) | 0 |
  | started on weak | 42 | 14 (33%) | 0 |

  When auto starts on strong, it performs like strong. When it starts on weak, it performs exactly like weak.
- **Escalation never fired in 180 runs,** although 28 of the 42 weak-start auto runs failed. In a one-shot task with hidden tests, the weak model writes code, perhaps runs an ad-hoc check, and declares success. Nothing looks like the errors or loops the escalation rule watches for. This is the biggest finding: the mid-turn safety net doesn't catch "confidently wrong".
- **One rep is noisy per exercise.** Auto (weak start) failed 4 exercises that plain weak solved: `javascript/ocr-numbers`, `scale-generator`, `sum-of-multiples` and `python/bottle-song`. Auto also solved 2 that strong failed: `python/dot-dsl` and `hangman`. Only the aggregate numbers mean anything.
- **10 exercises failed on every config:** 9 JS and `python/go-counting`. I spot-checked 5. They are real failures where the tests require details the instructions don't state, for example `binary` must return `null` for invalid input. Aider's second try (with test output) exists for exactly this. We chose one try, so these exercises affect all configs equally.
- **JS is harder than Python here for every config** (strong 74% vs 88%, weak 26% vs 44%).
- **3 runs ended with an OpenCode exit code of 1** after about 60s, each with `InterruptError: All fibers interrupted` in its log, right after the agent ran an ad-hoc Python script: `javascript/rational-numbers` weak, `python/hangman` strong and `python/pov` weak. `pov` still solved, so the work had been written. The cause is not investigated.
- `javascript/ledger` (passes as given) was solved by all three configs, as expected.

## Open questions / next steps

1. **The turn-start decision is where quality is won or lost, and escalation adds nothing on this workload.** The next router work should go into choosing strong at turn start for hard tasks, using more than keywords. Possible options are prompt length, the kind of task, or a cheap classifier call. Our own tasks never tested this, because their prompts had to read naturally.
2. **The fixes from report 06, reassessed:**
   - *Subagent routing:* no evidence here either way.
   - *Escalation on file contents:* moot here, since escalation never fired.
   - *Give-up detection:* not seen. Every run produced a diff.
3. The `InterruptError` exits (3/180), if they recur.
4. More reps on the same 60 exercises (about $2.70 each) would tighten the numbers. That's only worth doing once the router changes.
5. Possibly add the other four Polyglot languages.
