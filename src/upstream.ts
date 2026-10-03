import { upstreamAuthorization } from "./auth.ts";
import type { Config } from "./config.ts";
import { costUSD } from "./log/cost.ts";
import { appendLog, captureExchange, type DecisionLogLine } from "./log/decisions.ts";
import { parseUsage, reasoningIdsOf, ResponsesStreamReader, type Usage } from "./sse.ts";

const DROP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "authorization",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

const DROP_RESPONSE_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

export interface ForwardDeps {
  cfg: Config;
  apiKey: () => Promise<string | null>;
  fetch?: typeof fetch;
  /** Called once the response has fully streamed and the log line is written. */
  onLogged?: (line: DecisionLogLine) => void;
  /** Called with the reasoning item IDs a response produced and the model that produced them. */
  onReasoning?: (model: string, ids: string[]) => void;
}

/** The request-side half of a log line, filled in by the router before forwarding. */
export type LogBase = Omit<
  DecisionLogLine,
  "responseId" | "status" | "usage" | "costUSD" | "allStrongCostUSD" | "latencyMs" | "ttftMs" | "error"
>;

function priced(cfg: Config, base: LogBase, usage: Usage | null) {
  if (!usage) return { costUSD: null, allStrongCostUSD: null };
  const tierPrice = base.tier ? cfg.tiers[base.tier].price : null;
  return {
    costUSD: tierPrice ? costUSD(usage, tierPrice) : null,
    allStrongCostUSD: costUSD(usage, cfg.tiers.strong.price),
  };
}

/**
 * Sends `bodyText` upstream and pipes the response back unchanged. A tee'd copy
 * of the stream is parsed for usage and logged after the client has received
 * everything, so logging never delays or alters the client stream.
 */
export async function forward(
  req: Request,
  upstreamPath: string,
  bodyText: string,
  base: LogBase,
  started: number,
  deps: ForwardDeps,
): Promise<Response> {
  const { cfg } = deps;

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!DROP_REQUEST_HEADERS.has(k.toLowerCase())) headers.set(k, v);
  });
  const auth = upstreamAuthorization(cfg, req.headers.get("authorization"), await deps.apiKey());
  if (auth) headers.set("authorization", auth);

  const finish = async (rest: Omit<DecisionLogLine, keyof LogBase | "costUSD" | "allStrongCostUSD">) => {
    const line: DecisionLogLine = { ...base, ...rest, ...priced(cfg, base, rest.usage) };
    await appendLog(cfg, line);
    deps.onLogged?.(line);
  };

  let upstream: Response;
  try {
    upstream = await (deps.fetch ?? fetch)(cfg.upstream.baseURL + upstreamPath, {
      method: req.method,
      headers,
      body: bodyText,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish({
      responseId: null,
      status: 502,
      usage: null,
      latencyMs: Math.round(performance.now() - started),
      ttftMs: null,
      error: `upstream_unreachable: ${message}`,
    });
    return Response.json({ error: { message: `agent-scaffold-router: upstream unreachable: ${message}` } }, { status: 502 });
  }
  const ttftMs = Math.round(performance.now() - started);

  const outHeaders = new Headers();
  upstream.headers.forEach((v, k) => {
    if (!DROP_RESPONSE_HEADERS.has(k.toLowerCase())) outHeaders.set(k, v);
  });

  if (!upstream.body) {
    await finish({ responseId: null, status: upstream.status, usage: null, latencyMs: ttftMs, ttftMs, error: null });
    return new Response(null, { status: upstream.status, headers: outHeaders });
  }

  const [toClient, toLog] = upstream.body.tee();
  const isSSE = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");

  (async () => {
    const decoder = new TextDecoder();
    const reader = new ResponsesStreamReader();
    let text = "";
    for await (const chunk of toLog as unknown as AsyncIterable<Uint8Array>) {
      const s = decoder.decode(chunk, { stream: true });
      text += s;
      if (isSSE) reader.push(s);
    }
    text += decoder.decode();
    let summary = reader.end();
    if (!isSSE) {
      try {
        const j = JSON.parse(text);
        summary = {
          ...summary,
          usage: parseUsage(j.usage),
          responseId: j.id ?? null,
          model: j.model ?? null,
          error: j.error ?? null,
          reasoningIds: reasoningIdsOf(j.output),
        };
      } catch {
        // non-JSON body (e.g. an HTML error page); keep the empty summary
      }
    }
    if (base.upstreamModel && summary.reasoningIds.length) deps.onReasoning?.(base.upstreamModel, summary.reasoningIds);
    await captureExchange(cfg, base.requestId, bodyText, text, upstream.status, headers);
    await finish({
      responseId: summary.responseId,
      status: upstream.status,
      usage: summary.usage,
      latencyMs: Math.round(performance.now() - started),
      ttftMs,
      error: summary.error ? JSON.stringify(summary.error).slice(0, 2000) : upstream.ok ? null : text.slice(0, 2000),
    });
  })().catch((err) => console.error(`[agent-scaffold-router] log error for ${base.requestId}:`, err));

  return new Response(toClient, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders });
}
