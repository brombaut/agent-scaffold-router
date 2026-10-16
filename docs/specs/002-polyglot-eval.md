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

**Goal:** compare `router/weak`, `router/strong` and `router/auto` *against each other* on the same harness. We will not compare against Aider's published leaderboard. So we run Polyglot's exercises and tests unmodified through our own OpenCode harness, and the scores are ours, not Aider's.

## The benchmark

Pinned at commit `7e0611e77b54` of `Aider-AI/polyglot-benchmark` (2024-12-22, the last commit).

| language | exercises | test command (from Aider's harness) |
|---|---|---|
| C++ | 26 | `cmake -DEXERCISM_RUN_ALL_TESTS=1` + `make` |
| Go | 39 | `go test ./...` |
| Java | 47 | `./gradlew test`, after stripping `@Disabled` |
| JavaScript | 49 | `npm run test`, after `xtest(` → `test(` |
| Python | 34 | `pytest` |
| Rust | 30 | `cargo test -- --include-ignored` |
| **total** | **225** | |

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
| The agent runs on the host; only the check runs in Docker | Run OpenCode inside the container too | Much simpler, since the proxy, auth and isolated HOME stay as they are. The agent can't compile Go or Rust itself, because the host lacks those toolchains, but that's the same for every config, and we only compare configs with each other. We can move the agent into the container later if it matters. |
| Build our own image from Aider's Dockerfile, minus the Aider install | Use Aider's image | We only need the toolchains, not Aider itself. |

## What to build (all free)

1. **`eval/polyglot.sh`:** clones the benchmark at the pinned SHA into `eval/polyglot/`.
2. **`eval/polyglot/Dockerfile`:** Aider's Dockerfile without the `COPY . /aider` / `pip install` lines, plus Aider's `npm-test.sh` and `cpp-test.sh`.
3. **A loader in `eval/run.ts`:** `--suite polyglot [--langs py,js,…]` makes one `Task` per exercise, with the prompt, the hidden paths (`.meta/` plus the test files), the check (the Docker command) and the reference solution (`.meta`'s example files, for `self-check`).
4. **The second try:** if the check fails, run `opencode run --session <id>` with Aider's retry prompt and check again. Record `solved1` and `solved2`.
5. **Summary:** add language and solved@1/@2 columns.
6. **Free checks:** `self-check --suite polyglot` (every stub fails, every reference solution passes, all inside Docker) and `run --mock` on a few exercises per language.

Rough size: a few hundred lines, mostly the loader and the Docker check. The Docker image build downloads Go, Rust, Node and the JDK, which takes a few GB and a few minutes, once.

## Cost and time estimates

From our runs so far, a hard task costs **weak $0.0031** on average (max $0.008) and **strong $0.041** (max $0.079). Polyglot prompts are longer and some runs take 2 tries, so I assume **2–3× that**:

| one pass over all 225 exercises | estimate | wall time (sequential, ~60s/run) |
|---|---|---|
| weak | **$1.50–2.50** | ~4 h |
| auto | $3–8 (depends on how often it escalates) | ~4 h |
| strong | **$18–28** | ~4 h |

**The remaining eval budget is $3.06 of the approved $5.** A full three-config comparison doesn't fit; it needs roughly $25–40.

## Staged plan, each stage gated on the user's go

| stage | what | cost | decides |
|---|---|---|---|
| 0 | Build the above; self-check and mock runs | $0 | The harness works on all 225 exercises |
| 1 | **Weak only**, all 225, 1 rep | ~$2 (fits the current budget) | **Is the gap real?** If weak passes most of them, stop here and rethink (SWE-bench) before spending more. |
| 2 | **Strong** on every exercise weak failed, plus 30 random ones weak passed | ~$0.08 × (failures + 30), e.g. ~$10 if weak fails 100 | How much strong actually rescues, and how often strong fails where weak passes |
| 3 | **Auto** on all 225 | $3–8 | The router's cost and quality against both baselines |
| 4 | More reps on the exercises where results disagree | TBD | Noise |

Stages 2–3 need a **budget increase**, which is the user's call after seeing stage 1.

## Open questions for the user

1. **Budget:** OK to plan stages 2–3 around about $20 more, decided after stage 1's results?
2. **Languages:** all six, or start with Python and JavaScript (83 exercises, the quickest to get right)?
3. **Tries:** 2 as in Aider (recommended), or 1?
4. **Parallelism:** sequential runs take about 4 h per config. Running in parallel would mean attributing log lines by session key instead of by time window. Worth building now, or accept the wall time?
