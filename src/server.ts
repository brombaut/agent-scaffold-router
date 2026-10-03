import type { Config } from "./config.ts";
import type { DecisionLogLine } from "./log/decisions.ts";
import { newRequestId } from "./log/decisions.ts";
import { inspectRequest } from "./responses/inspect.ts";
import { route, UnknownModelError, VIRTUAL_MODELS, type RouteDeps } from "./router/policy.ts";
import { forward, type ForwardDeps, type LogBase } from "./upstream.ts";

export interface ServerOptions extends Omit<ForwardDeps, "cfg"> {
  hostname?: string;
  score?: RouteDeps["score"];
}

const MAX_REMEMBERED_RESPONSES = 10_000;
const MAX_REMEMBERED_REASONING = 50_000;

/** Insertion-ordered map that evicts its oldest entries past `max`. */
function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value!);
}

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: { message, type: "invalid_request_error" } }, { status });
}

export function startServer(cfg: Config, opts: ServerOptions) {
  // responseId -> session, for clients that chain turns with previous_response_id.
  const responses = new Map<string, { sessionKey: string; turnIndex: number }>();
  // reasoning item ID -> upstream model that produced it.
  const reasoningOwners = new Map<string, string>();
  const remember = (line: DecisionLogLine) => {
    if (line.responseId && line.sessionKey && line.turnIndex !== null) {
      boundedSet(responses, line.responseId, { sessionKey: line.sessionKey, turnIndex: line.turnIndex }, MAX_REMEMBERED_RESPONSES);
    }
  };
  const deps: ForwardDeps = {
    cfg,
    apiKey: opts.apiKey,
    fetch: opts.fetch,
    onLogged: (line) => {
      remember(line);
      opts.onLogged?.(line);
    },
    onReasoning: (model, ids) => {
      for (const id of ids) boundedSet(reasoningOwners, id, model, MAX_REMEMBERED_REASONING);
      opts.onReasoning?.(model, ids);
    },
  };
  const routeDeps: RouteDeps = { memory: responses, reasoningOwners, score: opts.score };

  async function handleResponses(req: Request): Promise<Response> {
    const started = performance.now();
    let body: any;
    try {
      body = JSON.parse(await req.text());
    } catch {
      return errorResponse(400, "request body must be JSON");
    }
    const requestId = newRequestId();
    const shape = cfg.log.captureBodies ? inspectRequest(body) : undefined;

    let decision;
    try {
      decision = route(body, cfg, routeDeps);
    } catch (err) {
      if (err instanceof UnknownModelError) return errorResponse(400, err.message);
      throw err;
    }
    const t = decision.turn;
    const base: LogBase = {
      ts: new Date().toISOString(),
      requestId,
      sessionKey: t?.sessionKey ?? null,
      sessionKeySource: t?.sessionKeySource ?? null,
      turnIndex: t?.turnIndex ?? null,
      isTurnStart: t?.isTurnStart ?? null,
      kind: t?.kind ?? null,
      requestedModel: decision.requestedModel,
      tier: decision.tier,
      upstreamModel: decision.upstreamModel,
      reason: decision.reason,
      droppedReasoning: decision.droppedReasoning,
      ...(shape ? { shape } : {}),
    };
    return forward(req, "/responses", JSON.stringify(body), base, started, deps);
  }

  return Bun.serve({
    // Loopback only: the proxy spends the user's money.
    hostname: opts.hostname ?? "127.0.0.1",
    port: cfg.port,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/healthz") return Response.json({ ok: true });
      if (req.method === "GET" && url.pathname === "/v1/models") {
        return Response.json({
          object: "list",
          data: VIRTUAL_MODELS.map((id) => ({ id, object: "model", owned_by: "agent-scaffold-router" })),
        });
      }
      if (req.method === "POST" && url.pathname === "/v1/responses") return handleResponses(req);
      return errorResponse(404, "not supported by agent-scaffold-router");
    },
  });
}
