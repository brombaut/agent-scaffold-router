import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Config, TierName } from "../config.ts";
import type { RequestShape } from "../responses/inspect.ts";
import type { RequestKind, SessionKeySource } from "../responses/items.ts";
import type { Usage } from "../sse.ts";

/** One line per proxied request in decisions.jsonl. */
export interface DecisionLogLine {
  ts: string;
  requestId: string;
  sessionKey: string | null;
  sessionKeySource: SessionKeySource | null;
  turnIndex: number | null;
  isTurnStart: boolean | null;
  kind: RequestKind | null;
  requestedModel: string | null;
  tier: TierName | null;
  upstreamModel: string | null;
  /** e.g. "heuristic:score=4[...]", "override:!strong", "escalate:tool_errors=3", "forced", "title", "router_error" */
  reason: string | null;
  /** Reasoning items removed because another model produced them (report 03). */
  droppedReasoning: number;
  responseId: string | null;
  status: number;
  usage: Usage | null;
  costUSD: number | null;
  /** The same usage priced at strong-tier rates: the counterfactual for savings. */
  allStrongCostUSD: number | null;
  latencyMs: number;
  ttftMs: number | null;
  error: string | null;
  /** Request shape summary; only written when body capture is on. */
  shape?: RequestShape;
}

export async function appendLog(cfg: Config, line: DecisionLogLine): Promise<void> {
  await mkdir(dirname(cfg.log.path), { recursive: true });
  await appendFile(cfg.log.path, JSON.stringify(line) + "\n");
}

const SECRET_HEADERS = new Set(["authorization", "cookie", "x-api-key", "api-key", "proxy-authorization"]);

/**
 * Writes the forwarded request body, the forwarded request headers (credentials
 * removed) and the raw upstream response, for debugging.
 */
export async function captureExchange(
  cfg: Config,
  requestId: string,
  requestBody: string,
  responseText: string,
  status: number,
  requestHeaders?: Headers,
): Promise<void> {
  if (!cfg.log.captureBodies) return;
  await mkdir(cfg.log.captureDir, { recursive: true });
  if (requestHeaders) {
    const safe: Record<string, string> = {};
    requestHeaders.forEach((v, k) => {
      if (!SECRET_HEADERS.has(k.toLowerCase())) safe[k] = v;
    });
    await writeFile(join(cfg.log.captureDir, `${requestId}.headers.json`), JSON.stringify(safe, null, 2));
  }
  await writeFile(join(cfg.log.captureDir, `${requestId}.request.json`), requestBody);
  await writeFile(join(cfg.log.captureDir, `${requestId}.response.${status}.txt`), responseText);
}

/** Time-sortable request ID: 10 chars of base36 millis + 8 random hex. */
export function newRequestId(): string {
  const rand = crypto.getRandomValues(new Uint8Array(4));
  return Date.now().toString(36).padStart(10, "0") + Buffer.from(rand).toString("hex");
}
