#!/bin/bash
# Polyglot suite setup: clones Aider's benchmark at the pinned commit into eval/polyglot/
# (gitignored) and builds the asr-polyglot test image.
set -euo pipefail
SHA=7e0611e77b54
DIR="$(dirname "$0")/polyglot"
[ -d "$DIR/.git" ] || git clone -q https://github.com/Aider-AI/polyglot-benchmark.git "$DIR"
git -C "$DIR" checkout -q "$SHA"
echo "polyglot-benchmark at $(git -C "$DIR" rev-parse --short=12 HEAD) in $DIR"
docker build -q -t asr-polyglot - < "$(dirname "$0")/polyglot.Dockerfile" >/dev/null
echo "built docker image asr-polyglot"
