# 002 — Plan: evaluate the router on Aider Polyglot's exercises

**Date:** 2026-10-16
**Status:** built 2026-10-17 (see [eval README](../../eval/README.md#polyglot-suite)). The paid run needs the user's explicit go.
**Context:** [progress report 06](../progress/06_progress_report.md), [eval README](../../eval/README.md)

## Why

Our own tasks can't separate the tiers. Across three rounds, the weak model (`gpt-6-luna`) solved nearly every hard task:

| round | weak, hard tasks |
|---|---|
| 12 tasks, visible tests | 17/18 |
| 5 harder tasks, visible tests | 9/10 |
| all 17 tasks, hidden tests | 19/22 (two failures were spec gaps on our side) |

So we stop writing tasks and use problems that were picked *because* models fail them: [Aider Polyglot](https://github.com/Aider-AI/polyglot-benchmark), the 225 hardest Exercism exercises across six languages.

**Scope: a subset, not the whole benchmark.** A full pass of all three configs would cost about $25–40 and take about 12 hours. Instead we use **one fixed subset of 60 Python and JavaScript exercises**, and run all three configs on exactly those 60. That's about **$8.30**, inside the **$10 eval budget** (raised on 2026-10-16). See [Subset and cost](#subset-and-cost).

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
  passed? → solved
```

One try, with the tests hidden. Aider gives a second try with the test output, but we don't need it (see below).

### Decisions in this design

| Decision | Alternatives | Why |
|---|---|---|
| Read exercises straight from a pinned clone; don't copy or edit them into `eval/tasks/` | Convert them into our task format | Keeps the benchmark unmodified. A small loader turns an exercise dir into our `Task` at run time. |
| The clone lives in `eval/polyglot/` (gitignored), fetched by a script at the pinned SHA | Commit the exercises | Keeps the repo small, and the pinned SHA makes it reproducible. |
| Hide `.meta/` and the test files during the agent's turn | Hide only the tests (our current `--hide-tests`) | `.meta/` holds the reference solution. |
| 1 try | 2 tries, as in Aider | We only compare our configs against each other, so matching Aider's protocol buys nothing. A scripted retry that pastes test output isn't a realistic second turn. One try is cheaper and needs less code. |
| The agent runs on the host; only the check runs in Docker | Run OpenCode inside the container too | Much simpler, since the proxy, auth and isolated HOME stay as they are. The host has Node and Python, so the agent can run code itself, the same for every config. |
| Build a small image with only the Node and Python parts of Aider's Dockerfile | Use Aider's full image | We only need two toolchains, not Aider itself or Go, Rust, Java and C++. |
| A seeded random subset, picked once and written to a file | Hand-pick exercises | No cherry-picking, and the exact set is reproducible. |

## What to build (all free)

1. **`eval/polyglot.sh`:** clones the benchmark at the pinned SHA into `eval/polyglot/`.
2. **`eval/polyglot.Dockerfile`:** the Node and Python parts of Aider's Dockerfile (Node 20 with its pinned jest/babel packages, Python 3.11 with pytest), plus Aider's `npm-test.sh`.
3. **`eval/polyglot-subset.txt`:** the 60 exercises, drawn once with a fixed seed from the 83 Python and JS ones (35 JS and 25 Python, in proportion). Committed, so every run uses the same set.
4. **A loader in `eval/run.ts`:** `--suite polyglot` makes one `Task` per exercise in the subset file, with the prompt, the hidden paths (`.meta/` plus the test files), the check (the Docker command) and the reference solution (`.meta`'s example files, for `self-check`). `--tasks` still narrows it further.
5. **Summary:** add a language column.
6. **Free checks:** `self-check --suite polyglot` (every stub fails, every reference solution passes, inside Docker) and `run --mock` on a couple of exercises per language.

Rough size: a couple of hundred lines, mostly the loader and the Docker check.

## Subset and cost

From our runs so far, a hard task costs **weak $0.0031** on average (max $0.008) and **strong $0.041** (max $0.079), at about 60s per run. Polyglot prompts are longer, so I assume **2–3× that**.

All three configs run on the same 60 exercises, 1 rep:

| config | per run | 60 runs |
|---|---|---|
| weak | ~$0.008 | ~$0.50 |
| auto | ~$0.03 | ~$1.80 |
| strong | ~$0.10 | ~$6.00 |
| **total** | | **~$8.30** |

The run uses `--budget 10`, so the proxy stops it if the estimate is wrong. 180 runs at about 60s each take **about 3 hours**.

With 60 exercises and 1 rep, small differences between configs are noise. This shows whether the router helps; it doesn't give precise numbers.

## Open questions for the user

None. Tries: 1 (decided 2026-10-16).
