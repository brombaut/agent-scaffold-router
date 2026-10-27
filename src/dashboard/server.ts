import type { Config } from "../config.ts";
import { parseLog } from "../report.ts";
import { buildDashboard } from "./data.ts";

export interface DashboardServerOptions {
  port?: number;
}

const securityHeaders = {
  "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: securityHeaders });
}

/** parseLog handles JSON syntax; reject values that cannot safely feed the shared report. */
function isDecisionRecord(value: unknown): value is import("../log/decisions.ts").DecisionLogLine {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const nullableString = (v: unknown) => v === null || typeof v === "string";
  const nullableNumber = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
  return typeof row.ts === "string" && Number.isFinite(Date.parse(row.ts))
    && typeof row.requestId === "string"
    && nullableString(row.sessionKey) && nullableNumber(row.turnIndex)
    && (row.kind === null || ["agent", "title", "compaction"].includes(row.kind as string))
    && (row.isTurnStart === null || typeof row.isTurnStart === "boolean")
    && (row.tier === null || row.tier === "strong" || row.tier === "weak")
    && nullableString(row.reason) && nullableString(row.error)
    && typeof row.status === "number" && Number.isFinite(row.status)
    && typeof row.latencyMs === "number" && Number.isFinite(row.latencyMs)
    && nullableNumber(row.ttftMs) && nullableNumber(row.costUSD) && nullableNumber(row.allStrongCostUSD)
    && (row.classifierCostUSD === undefined || typeof row.classifierCostUSD === "number")
    && (row.arm === undefined || row.arm === "on" || row.arm === "shadow")
    && (row.usage === null || (typeof row.usage === "object" && row.usage !== null
      && ["input", "output", "cachedRead"].every((key) => typeof (row.usage as Record<string, unknown>)[key] === "number")));
}

function localRequest(req: Request, port: number): boolean {
  const host = req.headers.get("host");
  if (!host) return false;
  let parsed: URL;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || Number(parsed.port || 80) !== port) return false;
  const origin = req.headers.get("origin");
  return !origin || origin === `http://${host}`;
}

function cutoffFor(range: string | null, now: Date): number | null {
  const hours: Record<string, number> = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };
  return range && hours[range] ? now.getTime() - hours[range]! * 60 * 60 * 1000 : null;
}

export function startDashboardServer(cfg: Config, opts: DashboardServerOptions = {}) {
  const port = opts.port ?? 8788;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 0,
    async fetch(req) {
      if (!localRequest(req, server.port!)) return json({ error: "Local requests only" }, 403);
      const url = new URL(req.url);
      if (req.method !== "GET") return json({ error: "GET only" }, 405);
      if (url.pathname === "/api/dashboard") {
        const now = new Date();
        try {
          const file = Bun.file(cfg.log.path);
          const raw = (await file.exists()) ? await file.text() : "";
          const cutoff = cutoffFor(url.searchParams.get("range"), now);
          const parsed = parseLog(raw);
          const valid = parsed.filter(isDecisionRecord);
          const lines = valid.filter((line) => cutoff === null || Date.parse(line.ts) >= cutoff);
          return json({ ...buildDashboard(lines, now, valid), logAvailable: await file.exists(), invalidRecords: parsed.length - valid.length });
        } catch {
          return json({ ...buildDashboard([], now), logAvailable: false, logError: "Could not read the local decision log." });
        }
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        try {
          const html = await Bun.file(new URL("./index.html", import.meta.url)).text();
          return new Response(html, {
            headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8" },
          });
        } catch {
          return new Response("Dashboard page is unavailable.", { status: 500, headers: securityHeaders });
        }
      }
      return json({ error: "Not found" }, 404);
    },
  });
  return server;
}
