# 002 — Plan: evaluate the router on Aider Polyglot's exercises

**Date:** 2026-10-16
**Status:** plan only. Nothing is built, and every paid stage needs the user's explicit go.
**Context:** [progress report 06](../progress/06_progress_report.md), [eval README](../../eval/README.md)

## Why

Our own tasks can't separate the tiers. Across three rounds, the weak model (`gpt-6-luna`) solved nearly every hard task:

| round | weak, hard tasks |
|---|---|
| 12 tasks, visible tests | 17/18 |
| 5 harder tasks, visible tests | 9/10 |
| all 17 tasks, hidden tests | 19/22 (two failures were spec gaps on our side) |

So we stop writing tasks and use problems that were picked *because* models fail them: [Aider Polyglot](https://github.com/Aider-AI/polyglot-benchmark), the 225 hardest Exercism exercises across six languages.

**Scope: a subset, not the whole benchmark.** A full pass of all three configs would cost about $25–40 and take about 12 hours. Instead we use **Python and JavaScript only** (83 exercises), screen **40** of them on weak, and run strong and auto on **15**. That's about **$2.20 and 70 minutes** in total, inside the $3.06 left of the approved eval budget. See [Subset and cost](#subset-and-cost).

**Goal:** compare `router/weak`, `router/strong` and `router/auto` *against each other* on the same harness. We will not compare against Aider's published leaderboard. So we run Polyglot's exercises and tests unmodified through our own OpenCode harness, and the scores are ours, not Aider's.

## The benchmark

Pinned at commit `7e0611e77b54` of `Aider-AI/polyglot-benchmark` (2024-12-22, the last commit).

| language | exercises | test command (from Aider's harness) | in scope |
|---|---|---|---|
| JavaScript | 49 | `npm run test`, after `xtest(` → `test(` | **yes** |
| Python | 34 | `pytest` | **yes** |
| C++ | 26 | `cmake -DEXERCISM_RUN_ALL_TESTS=1` + `make` | no |
| Go | 39 | `go test ./...` | no |
| Java | 47 | `./gradlew test`, after stripping `@Disabled` | no |
| Rust | 30 | `cargo test -- --include-ignored` | no |
| **total** | **225** | | **83** |

Why Python and JS: they have the most exercises, their tests run in seconds (no compile step), and the Docker image only needs Node and Python, so it is small and quick to build. The other four languages can be added later with no change to the design.

Each exercise is an Exercism directory:

```
<lang>/exercises/practice/<name>/
  .docs/introduction.md?, instructions.md, instructions.append.md?   → the prompt
  .meta/config.json        → lists the solution, test and example files
  .meta/example.* | proof.ci.js   → REFERENCE SOLUTION (must never reach the agent)
  <stub files>             → what the agent edits
  <test files>             → hidden from the agent, used for the check
```

The test commands, the test-file tweaks and the prompt wording all come from Aider's harness at `Aider-AI/aider@38d4341e5976`, in `benchmark/benchmark.py`, `prompts.py` and `Dockerfile`. We copy them as they are.

## How a run works

```
for each rep × exercise × config:
  workspace ← exercise dir  MINUS  .meta/  and the test files   (and git-commit it)
  turn 1: opencode run -m router/<config> "<intro + instructions + append>
             + Aider's addendum: 'Use the above instructions to modify the supplied files: <stubs> …'"
  check:  copy the test files back, apply Aider's tweaks, run the language's test
          command inside the polyglot Docker image (workspace mounted)
  passed? → solved@1, done
  failed? → turn 2 in the SAME session (opencode run --session <id>):
             "<test output>  ####  See the testing errors above. The tests are correct,
              don't try and change them. Fix the code in <stubs> to resolve the errors."
          → check again → solved@2
```

This is Aider's protocol: 2 tries, tests hidden, test output shown on the retry. A bonus for us is that turn 2 is a real second user turn, so it exercises per-turn routing. A failing turn 1 on weak, for example, can move turn 2 to strong.

### Decisions in this design

| Decision | Alternatives | Why |
|---|---|---|
| Read exercises straight from a pinned clone; don't copy or edit them into `eval/tasks/` | Convert them into our task format | Keeps the benchmark unmodified. A small loader turns an exercise dir into our `Task` at run time. |
| The clone lives in `eval/polyglot/` (gitignored), fetched by a script at the pinned SHA | Commit the exercises | Keeps the repo small, and the pinned SHA makes it reproducible. |
| Hide `.meta/` and the test files during the agent's turn | Hide only the tests (our current `--hide-tests`) | `.meta/` holds the reference solution. |
| 2 tries, as in Aider | 1 try | Matches the source protocol and tests multi-turn routing. We report solved@1 and solved@2. |
| The agent runs on the host; only the check runs in Docker | Run OpenCode inside the container too | Much simpler, since the proxy, auth and isolated HOME stay as they are. The host has Node and Python, so the agent can run code itself, the same for every config. |
| Build a small image with only the Node and Python parts of Aider's Dockerfile | Use Aider's full image | We only need two toolchains, not Aider itself or Go, Rust, Java and C++. |
| A seeded random subset, picked once and written to a file | Hand-pick exercises | No cherry-picking, and the exact set is reproducible. |

## What to build (all free)

1. **`eval/polyglot.sh`:** clones the benchmark at the pinned SHA into `eval/polyglot/`.
2. **`eval/polyglot.Dockerfile`:** the Node and Python parts of Aider's Dockerfile (Node 20 with its pinned jest/babel packages, Python 3.11 with pytest), plus Aider's `npm-test.sh`.
3. **`eval/polyglot-subset.txt`:** the 40 exercises, drawn once with a fixed seed from the 83 Python and JS ones (proportionally, so about 24 JS and 16 Python). Committed, so every run uses the same set.
4. **A loader in `eval/run.ts`:** `--suite polyglot` makes one `Task` per exercise in the subset file, with the prompt, the hidden paths (`.meta/` plus the test files), the check (the Docker command) and the reference solution (`.meta`'s example files, for `self-check`). `--tasks` still narrows it further.
5. **The second try:** if the check fails, run `opencode run --session <id>` with Aider's retry prompt and check again. Record `solved1` and `solved2`.
6. **Summary:** add language and solved@1/@2 columns.
7. **Free checks:** `self-check --suite polyglot` (every stub fails, every reference solution passes, inside Docker) and `run --mock` on a couple of exercises per language.

Rough size: a couple of hundred lines, mostly the loader and the Docker check.

## Subset and cost

From our runs so far, a hard task costs **weak $0.0031** on average (max $0.008) and **strong $0.041** (max $0.079), at about 60s per run. Polyglot prompts are longer and some runs take 2 tries, so I assume **2–3× that**: about **$0.008 per weak run and $0.10 per strong run**, with auto somewhere in between.

| stage | what | runs | cost | time | gate |
|---|---|---|---|---|---|
| 0 | Build it; self-check and mock runs | — | $0 | — | — |
| 1 | **Weak** on the 40-exercise subset, 1 rep | 40 | ~$0.35 | ~40 min | user's go |
| 2 | **Strong and auto** on 15 of those 40: every exercise weak failed (up to 15), topped up with randomly chosen weak passes | 30 | ~$1.80 | ~30 min | user's go |
| | **total** | **70** | **~$2.20** | **~70 min** | inside the $3.06 left |

**Stop rule after stage 1:** if weak solves 35 or more of the 40 (≥ 88%), Polyglot doesn't separate the tiers either. We stop and rethink before spending more.

**What the numbers mean:**
- Stage 1 gives an **unbiased weak pass rate** on Python/JS Polyglot.
- The stage-2 set is **deliberately enriched for exercises weak fails**, so it shows whether strong rescues them and whether auto finds them. It is not a random sample, so its pass rates are not "the" pass rate. We'll report it that way.
- With 15 exercises and 1 rep, only large differences mean anything. A 3-out-of-15 gap is noise. This is a cheap sign of whether the router helps, not a precise measurement. If it looks promising, we can decide then whether a bigger run is worth it.

## Open questions for the user

1. **Subset size:** 40 to screen and 15 for strong/auto (about $2.20), or smaller or bigger?
2. **Tries:** 2 as in Aider (recommended), or 1? With 1 try, a failure costs a bit less, and turn 2 can no longer test per-turn routing.
