#!/usr/bin/env bun
import { resolveApiKey } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { aggregate, formatReport, parseLog } from "./report.ts";
import { startServer } from "./server.ts";

const USAGE = `agent-scaffold-router <command>

Commands:
  serve [--port N] [--capture]       Start the proxy on 127.0.0.1 (default port 8787).
                                     --capture writes request/response bodies to the capture dir.
  report [--since ISO] [--json]      Summarize decisions.jsonl per session and in total:
                                     requests, % strong, cache-read ratio, cost, all-strong cost, savings.
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function serve(args: string[]) {
  const port = flag(args, "--port");
  const cfg = await loadConfig(undefined, {
    ...(port ? { port: Number(port) } : {}),
    ...(args.includes("--capture") ? { log: { captureBodies: true } } : {}),
  });

  let cached: Promise<string | null> | null = null;
  const apiKey = () => (cached ??= resolveApiKey(cfg));
  if (cfg.upstream.auth === "inject" && !(await apiKey())) {
    console.error(
      `No upstream API key: set ${cfg.upstream.apiKeyEnv} or connect OpenCode Zen with \`opencode auth login\`.`,
    );
    process.exit(1);
  }

  const server = startServer(cfg, { apiKey });
  console.log(`agent-scaffold-router listening on http://${server.hostname}:${server.port}/v1`);
  console.log(`  models:   auto, strong (${cfg.tiers.strong.model}), weak (${cfg.tiers.weak.model})`);
  console.log(`  upstream: ${cfg.upstream.baseURL} (auth: ${cfg.upstream.auth})`);
  console.log(`  log:      ${cfg.log.path}${cfg.log.captureBodies ? `\n  capture:  ${cfg.log.captureDir}` : ""}`);
}

async function report(args: string[]) {
  const cfg = await loadConfig();
  const file = Bun.file(cfg.log.path);
  if (!(await file.exists())) {
    console.error(`No log yet at ${cfg.log.path}. Start the proxy with \`agent-scaffold-router serve\`.`);
    process.exit(1);
  }
  const since = flag(args, "--since");
  const lines = parseLog(await file.text()).filter((l) => !since || l.ts >= since);
  const result = aggregate(lines);
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : formatReport(result));
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "serve":
    await serve(rest);
    break;
  case "report":
    await report(rest);
    break;
  default:
    console.log(USAGE);
    process.exit(cmd && cmd !== "help" && cmd !== "--help" ? 1 : 0);
}
