import { upstreamAuthorization } from "./auth.ts";
import type { Config } from "./config.ts";
import { appendLog, captureExchange, type RequestLogLine } from "./log/requests.ts";
import { inspectRequest } from "./responses/inspect.ts";
import { parseUsage, ResponsesStreamReader } from "./sse.ts";

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
  onLogged?: (line: RequestLogLine) => void;
}

/**
 * Forwards one request to the upstream unchanged (body bytes included) and pipes
 * the response back. A tee'd copy of the stream is parsed for usage and logged
 * after the client has received everything.
 */
export async function forward(req: Request, upstreamPath: string, requestId: string, deps: ForwardDeps): Promise<Response> {
  const { cfg } = deps;
  const started = performance.now();
  const bodyText = await req.text();

  let parsed: any = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }
  const shape = parsed ? inspectRequest(parsed) : null;

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!DROP_REQUEST_HEADERS.has(k.toLowerCase())) headers.set(k, v);
  });
  const auth = upstreamAuthorization(cfg, req.headers.get("authorization"), await deps.apiKey());
  if (auth) headers.set("authorization", auth);

  const baseLine = {
    ts: new Date().toISOString(),
    requestId,
    path: upstreamPath,
    requestedModel: shape?.model ?? null,
    shape,
  };

  let upstream: Response;
  try {
    upstream = await (deps.fetch ?? fetch)(cfg.upstream.baseURL + upstreamPath, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : bodyText,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const line: RequestLogLine = {
      ...baseLine,
      upstreamModel: null,
      responseId: null,
      status: 502,
      usage: null,
      latencyMs: Math.round(performance.now() - started),
      ttftMs: null,
      error: `upstream_unreachable: ${message}`,
    };
    await appendLog(cfg, line);
    deps.onLogged?.(line);
    return Response.json({ error: { message: `agent-scaffold-router: upstream unreachable: ${message}` } }, { status: 502 });
  }
  const ttftMs = Math.round(performance.now() - started);

  const outHeaders = new Headers();
  upstream.headers.forEach((v, k) => {
    if (!DROP_RESPONSE_HEADERS.has(k.toLowerCase())) outHeaders.set(k, v);
  });

  if (!upstream.body) {
    const line: RequestLogLine = {
      ...baseLine,
      upstreamModel: null,
      responseId: null,
      status: upstream.status,
      usage: null,
      latencyMs: ttftMs,
      ttftMs,
      error: null,
    };
    await appendLog(cfg, line);
    deps.onLogged?.(line);
    return new Response(null, { status: upstream.status, headers: outHeaders });
  }

  const [toClient, toLog] = upstream.body.tee();
  const isSSE = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");

  // Consume the log branch in the background; never let it affect the client stream.
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
        summary = { ...summary, usage: parseUsage(j.usage), responseId: j.id ?? null, model: j.model ?? null, error: j.error ?? null };
      } catch {
        // non-JSON body (e.g. an HTML error page); keep the empty summary
      }
    }
    const line: RequestLogLine = {
      ...baseLine,
      upstreamModel: summary.model,
      responseId: summary.responseId,
      status: upstream.status,
      usage: summary.usage,
      latencyMs: Math.round(performance.now() - started),
      ttftMs,
      error: summary.error ? JSON.stringify(summary.error).slice(0, 2000) : upstream.ok ? null : text.slice(0, 2000),
    };
    await captureExchange(cfg, requestId, bodyText, text, upstream.status);
    await appendLog(cfg, line);
    deps.onLogged?.(line);
  })().catch((err) => console.error(`[agent-scaffold-router] log error for ${requestId}:`, err));

  return new Response(toClient, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders });
}
