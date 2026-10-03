#!/usr/bin/env bun
import { resolveApiKey } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { startServer } from "./server.ts";

const USAGE = `agent-scaffold-router <command>

Commands:
  serve [--port N] [--capture]   Start the proxy on 127.0.0.1 (default port 8787).
                                 --capture writes request/response bodies to the capture dir.
`;

async function serve(args: string[]) {
  const portIdx = args.indexOf("--port");
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) : undefined;
  const cfg = await loadConfig(undefined, {
    ...(port ? { port } : {}),
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
  console.log(`  upstream: ${cfg.upstream.baseURL} (auth: ${cfg.upstream.auth})`);
  console.log(`  log:      ${cfg.log.path}${cfg.log.captureBodies ? `\n  capture:  ${cfg.log.captureDir}` : ""}`);
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "serve":
    await serve(rest);
    break;
  default:
    console.log(USAGE);
    process.exit(cmd ? 1 : 0);
}
