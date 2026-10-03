import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Config } from "../config.ts";
import type { RequestShape } from "../responses/inspect.ts";
import type { Usage } from "../sse.ts";

/** One line per proxied request. Child #2/#3 extend this into the full DecisionLogLine. */
export interface RequestLogLine {
  ts: string;
  requestId: string;
  path: string;
  requestedModel: string | null;
  upstreamModel: string | null;
  responseId: string | null;
  status: number;
  usage: Usage | null;
  latencyMs: number;
  ttftMs: number | null;
  error: string | null;
  shape: RequestShape | null;
}

export async function appendLog(cfg: Config, line: RequestLogLine): Promise<void> {
  await mkdir(dirname(cfg.log.path), { recursive: true });
  await appendFile(cfg.log.path, JSON.stringify(line) + "\n");
}

/** Writes the request body (never headers) and the raw upstream response for debugging. */
export async function captureExchange(
  cfg: Config,
  requestId: string,
  requestBody: string,
  responseText: string,
  status: number,
): Promise<void> {
  if (!cfg.log.captureBodies) return;
  await mkdir(cfg.log.captureDir, { recursive: true });
  await writeFile(join(cfg.log.captureDir, `${requestId}.request.json`), requestBody);
  await writeFile(join(cfg.log.captureDir, `${requestId}.response.${status}.txt`), responseText);
}

/** Time-sortable request ID: 10 chars of base36 millis + 8 random hex. */
export function newRequestId(): string {
  const rand = crypto.getRandomValues(new Uint8Array(4));
  return Date.now().toString(36).padStart(10, "0") + Buffer.from(rand).toString("hex");
}
