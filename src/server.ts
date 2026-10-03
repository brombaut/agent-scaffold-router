import type { Config } from "./config.ts";
import { newRequestId } from "./log/requests.ts";
import { forward, type ForwardDeps } from "./upstream.ts";

export interface ServerOptions extends Omit<ForwardDeps, "cfg"> {
  hostname?: string;
}

export function startServer(cfg: Config, opts: ServerOptions) {
  const deps: ForwardDeps = { cfg, ...opts };
  return Bun.serve({
    // Loopback only: the proxy spends the user's money.
    hostname: opts.hostname ?? "127.0.0.1",
    port: cfg.port,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/healthz") return Response.json({ ok: true });
      if (req.method === "GET" && url.pathname === "/v1/models") {
        const ids = [cfg.tiers.strong.model, cfg.tiers.weak.model];
        return Response.json({ object: "list", data: ids.map((id) => ({ id, object: "model", owned_by: "agent-scaffold-router" })) });
      }
      if (req.method === "POST" && url.pathname === "/v1/responses") {
        return forward(req, "/responses", newRequestId(), deps);
      }
      return Response.json({ error: { message: "not supported by agent-scaffold-router" } }, { status: 404 });
    },
  });
}
