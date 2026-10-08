# Evaluation harness

Runs each task with OpenCode through the router as `router/auto`, `router/strong` and `router/weak`, then compares tasks solved, cost per solved task and wall time.

```
for each rep × task × config (config order rotates per task):
  copy tasks/<id>/repo to a fresh git workspace in $TMPDIR
  opencode run -m router/<config> "<prompt>"   (isolated HOME, in-process proxy)
  save the diff, restore the protected test/ dir, run `bun test`
  attribute the proxy's log lines for this run → results.jsonl
```

## Commands

```sh
export PATH="$HOME/.bun/bin:$PATH:$HOME/.opencode/bin"
bun eval/run.ts list
bun eval/run.ts self-check                         # free: each task fails as given, passes with its solution
bun eval/run.ts run --mock --tasks greeting-typo   # free: fake upstream, smoke-tests the pipeline
bun eval/run.ts run --live --budget 5              # real Zen calls; spends money
bun eval/run.ts summarize eval/runs/<stamp>
```

Options for `run`: `--tasks a,b`, `--configs auto,strong,weak`, `--reps N`, `--timeout SECONDS` (default 600) and `--capture` (save request and response bodies).

## Design notes

- **Isolation.** Workspaces and OpenCode's `HOME`/XDG dirs are in a temp dir outside this repo. OpenCode therefore doesn't load this project's `AGENTS.md`, your global OpenCode config or your skills in `~/.claude/skills`. Its only config is `examples/opencode.jsonc`, pointed at the eval's own proxy.
- **Own proxy and log.** The runner starts the proxy in-process on a random port, with your `~/.config/agent-scaffold-router/config.json` applied. It logs to `eval/runs/<stamp>/decisions.jsonl`, not your everyday log.
- **Budget guard.** Once logged spend reaches `--budget`, the proxy answers further upstream calls with HTTP 402 and the current OpenCode run is killed. The most it can overshoot is whatever requests are already in flight.
- **No test tampering.** Each task's `test/` dir is restored from the original before the check, so editing the tests doesn't count as solving the task.
- **Attribution.** Runs are sequential, and every log line that arrives during a run belongs to it. `opencodeSession` and `sessionKeys` in each result let you cross-check this.

## Tasks

12 small TypeScript repos. Each has a failing `bun test`, a natural-sounding prompt in `task.json` and a reference fix in `solution/`, which is used only by `self-check`.

- **easy:** `greeting-typo`, `rename-function`, `add-clamp`, `range-off-by-one`, `slugify`, `config-default`
- **hard:** `lru-cache`, `async-fetch-all`, `csv-parser`, `emitter-once`, `token-bucket`, `deep-merge`

The prompts are written the way a user would write them, not tuned for the heuristic. Several hard tasks contain no strong keyword, which tests whether escalation catches what the turn-start heuristic misses.

## Output (`eval/runs/<stamp>/`, gitignored)

- `run.json`: the options, tiers and policy used.
- `results.jsonl`: one line per run.
- `summary.md`: the tables.
- `decisions.jsonl`: the proxy log.
- `<task>/<config>-r<rep>/`: `opencode.jsonl`, `opencode.err.log`, `diff.patch`, `check.txt` and `result.json`.
