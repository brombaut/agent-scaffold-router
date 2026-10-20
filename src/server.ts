import { createHash } from "node:crypto";
import type { Config, TierName } from "./config.ts";
import type { DecisionLogLine } from "./log/decisions.ts";
import { newRequestId } from "./log/decisions.ts";
import { inspectRequest } from "./responses/inspect.ts";
import { analyzeTurn } from "./responses/items.ts";
import { classify, type Classification } from "./router/classifier.ts";
import { scoreMessage } from "./router/heuristics.ts";
import { parseOverride } from "./router/overrides.ts";
import { route, UnknownModelError, VIRTUAL_MODELS, type RouteDeps } from "./router/policy.ts";
import { forward, type ForwardDeps, type LogBase } from "./upstream.ts";

export interface ServerOptions extends Omit<ForwardDeps, "cfg"> {
  hostname?: string;
  score?: RouteDeps["score"];
  /** Swappable for tests. */
  classify?: typeof classify;
}

const MAX_REMEMBERED_RESPONSES = 10_000;
const MAX_REMEMBERED_REASONING = 50_000;
const MAX_REMEMBERED_TURNS = 10_000;

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

  // Turn-start classifier (spec 003): one call per user turn, shared by all of the turn's requests.
  const classified = new Map<string, Promise<Classification>>();
  // sessionKey -> tier of the session's latest agent request, so the classifier knows who handled the last turn.
  const lastTier = new Map<string, TierName>();
  const armFor = (sessionKey: string): "on" | "shadow" | null => {
    const { mode } = cfg.policy.classifier;
    if (mode === "off") return null;
    if (mode !== "experiment") return mode;
    return parseInt(createHash("sha256").update(sessionKey).digest("hex").slice(0, 8), 16) % 2 ? "on" : "shadow";
  };

  /** Starts (or reuses) the turn's classification. Returns null when the classifier doesn't apply. */
  function classifyTurn(body: any) {
    if (body?.model !== "auto") return null;
    const turn = analyzeTurn(body, responses);
    const arm = turn.kind === "agent" ? armFor(turn.sessionKey) : null;
    if (!arm || parseOverride(turn.turnText)) return null;
    const perSession = cfg.policy.granularity === "session";
    const text = perSession ? turn.firstText : turn.turnText;
    const key = perSession ? turn.sessionKey : `${turn.sessionKey}#${turn.turnIndex}`;
    let pending = classified.get(key);
    const isNew = !pending;
    if (!pending) {
      const prev = lastTier.get(turn.sessionKey);
      const note = prev ? `[Follow-up message in an ongoing session. The previous turn was handled by the ${prev === "weak" ? "small" : "large"} model.]\n\n` : "";
      const run = opts.classify ?? classify;
      pending = opts
        .apiKey()
        .then((key) => run(note + text, cfg.policy.classifier.model, cfg, key ?? "", opts.fetch, cfg.policy.classifier.timeoutMs));
      boundedSet(classified, key, pending, MAX_REMEMBERED_TURNS);
    }
    const late = pending.then(
      (c): Partial<DecisionLogLine> => ({
        arm,
        classifierTier: c.tier,
        heuristicTier: scoreMessage(text, cfg.policy).tier,
        ...(isNew ? { classifierCostUSD: c.costUSD, classifierRaw: c.raw.slice(0, 200), turnPreview: text.slice(0, 500) } : {}),
      }),
    );
    return { arm, pending, late };
  }

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

    let classified: ReturnType<typeof classifyTurn> = null;
    let classifiedTier: TierName | undefined;
    try {
      classified = classifyTurn(body);
      // Only the "on" arm waits for the classifier; "shadow" logs it after the response.
      if (classified?.arm === "on") classifiedTier = (await classified.pending).tier;
    } catch (err) {
      console.error("[agent-scaffold-router] classifier failed:", err);
    }

    let decision;
    try {
      decision = route(body, cfg, { ...routeDeps, classifiedTier });
    } catch (err) {
      if (err instanceof UnknownModelError) return errorResponse(400, err.message);
      throw err;
    }
    const t = decision.turn;
    if (t?.kind === "agent") boundedSet(lastTier, t.sessionKey, decision.tier, MAX_REMEMBERED_TURNS);
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
    return forward(req, "/responses", JSON.stringify(body), base, started, deps, classified?.late);
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
