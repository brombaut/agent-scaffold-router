import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Config } from "../src/config.ts";
import type { DecisionLogLine } from "../src/log/decisions.ts";
import { startServer, type ServerOptions } from "../src/server.ts";

export const SSE_FIXTURE = [
  `event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","model":"gpt-6-luna","status":"in_progress"}}\n\n`,
  `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n`,
  `event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-6-luna","status":"completed","usage":{"input_tokens":120,"input_tokens_details":{"cached_tokens":100},"output_tokens":7,"output_tokens_details":{"reasoning_tokens":3}}}}\n\n`,
];

export interface Recorded {
  method: string;
  path: string;
  headers: Headers;
  body: string;
}

/** A mock upstream that records requests and replies with a canned response. */
export function mockUpstream(reply: (req: Request) => Response | Promise<Response>) {
  const seen: Recorded[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const body = await req.clone().text();
      seen.push({ method: req.method, path: new URL(req.url).pathname, headers: req.headers, body });
      return reply(req);
    },
  });
  return { server, seen, baseURL: `http://127.0.0.1:${server.port}/zen/v1` };
}

export function sseResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      for (const ch of chunks) {
        c.enqueue(enc.encode(ch));
        await Bun.sleep(1);
      }
      c.close();
    },
  });
  return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
}

export function testConfig(baseURL: string, extra: Partial<Config> = {}): Config {
  const dir = mkdtempSync(join(tmpdir(), "asr-test-"));
  return {
    ...DEFAULT_CONFIG,
    port: 0,
    upstream: { ...DEFAULT_CONFIG.upstream, baseURL },
    log: { path: join(dir, "decisions.jsonl"), captureBodies: false, captureDir: join(dir, "captures") },
    ...extra,
  };
}

/** Starts the proxy and returns a helper that waits for the next log line. */
export function startProxy(cfg: Config, key: string | null = "test-key", extra: { score?: ServerOptions["score"] } = {}) {
  const waiters: ((l: DecisionLogLine) => void)[] = [];
  const lines: DecisionLogLine[] = [];
  const server = startServer(cfg, {
    apiKey: async () => key,
    ...extra,
    onLogged: (l) => {
      lines.push(l);
      waiters.shift()?.(l);
    },
  });
  const nextLog = () =>
    new Promise<DecisionLogLine>((resolve) => {
      const existing = lines.shift();
      if (existing) resolve(existing);
      else waiters.push((l) => resolve(lines.splice(lines.indexOf(l), 1)[0]!));
    });
  return { server, url: `http://127.0.0.1:${server.port}`, nextLog };
}
