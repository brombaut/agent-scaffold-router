# Test image for the Polyglot suite: the Node and Python parts of Aider's
# benchmark/Dockerfile (Aider-AI/aider@38d4341e5976). Built by eval/polyglot.sh.
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pytest && rm -rf /var/lib/apt/lists/*
RUN mkdir /npm-install && cd /npm-install && npm init -y && npm install \
    jest@29.7.0 \
    @babel/core@7.25.2 \
    @exercism/babel-preset-javascript@0.2.1 \
    @exercism/eslint-config-javascript@0.6.0 \
    @types/jest@29.5.12 \
    @types/node@20.12.12 \
    babel-jest@29.6.4 \
    core-js@3.37.1 \
    eslint@8.49.0
