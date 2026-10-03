import type { DecisionLogLine } from "./log/decisions.ts";

export interface Totals {
  sessionKey: string;
  firstTs: string;
  lastTs: string;
  requests: number;
  turns: number;
  strongRequests: number;
  pctStrong: number;
  inputTokens: number;
  cachedReadTokens: number;
  cacheReadRatio: number;
  outputTokens: number;
  costUSD: number;
  allStrongCostUSD: number;
  savingsPct: number;
  errors: number;
  reasons: Record<string, number>;
}

function empty(sessionKey: string, ts: string): Totals {
  return {
    sessionKey,
    firstTs: ts,
    lastTs: ts,
    requests: 0,
    turns: 0,
    strongRequests: 0,
    pctStrong: 0,
    inputTokens: 0,
    cachedReadTokens: 0,
    cacheReadRatio: 0,
    outputTokens: 0,
    costUSD: 0,
    allStrongCostUSD: 0,
    savingsPct: 0,
    errors: 0,
    reasons: {},
  };
}

/** Reason family for the summary, e.g. "heuristic:score=4[...]" -> "heuristic". */
function reasonFamily(reason: string | null): string {
  if (!reason) return "none";
  return reason.split(/[:=[]/)[0]!;
}

function add(t: Totals, l: DecisionLogLine): void {
  t.requests++;
  if (l.isTurnStart && l.kind === "agent") t.turns++;
  if (l.tier === "strong") t.strongRequests++;
  // Zen can fail inside an HTTP 200 stream (e.g. capacity errors), so count those too.
  if (l.status >= 400 || l.error) t.errors++;
  if (l.ts < t.firstTs) t.firstTs = l.ts;
  if (l.ts > t.lastTs) t.lastTs = l.ts;
  if (l.usage) {
    t.inputTokens += l.usage.input;
    t.cachedReadTokens += l.usage.cachedRead;
    t.outputTokens += l.usage.output;
  }
  t.costUSD += l.costUSD ?? 0;
  t.allStrongCostUSD += l.allStrongCostUSD ?? 0;
  const fam = reasonFamily(l.reason);
  t.reasons[fam] = (t.reasons[fam] ?? 0) + 1;
}

function finalize(t: Totals): Totals {
  t.pctStrong = t.requests ? (100 * t.strongRequests) / t.requests : 0;
  t.cacheReadRatio = t.inputTokens ? t.cachedReadTokens / t.inputTokens : 0;
  t.savingsPct = t.allStrongCostUSD ? (100 * (t.allStrongCostUSD - t.costUSD)) / t.allStrongCostUSD : 0;
  return t;
}

export function parseLog(text: string): DecisionLogLine[] {
  const out: DecisionLogLine[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // skip a partially written trailing line
    }
  }
  return out;
}

export function aggregate(lines: DecisionLogLine[]): { sessions: Totals[]; total: Totals } {
  const bySession = new Map<string, Totals>();
  const total = empty("TOTAL", lines[0]?.ts ?? "");
  for (const l of lines) {
    const key = l.sessionKey ?? "(none)";
    let s = bySession.get(key);
    if (!s) bySession.set(key, (s = empty(key, l.ts)));
    add(s, l);
    add(total, l);
  }
  const sessions = [...bySession.values()].map(finalize).sort((a, b) => a.firstTs.localeCompare(b.firstTs));
  return { sessions, total: finalize(total) };
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const pct = (n: number) => `${n.toFixed(0)}%`;

export function formatReport({ sessions, total }: { sessions: Totals[]; total: Totals }): string {
  const header = ["session", "started", "reqs", "turns", "strong", "cache", "cost", "all-strong", "saved"];
  const row = (t: Totals) => [
    t.sessionKey.length > 22 ? t.sessionKey.slice(0, 21) + "…" : t.sessionKey,
    t.firstTs.slice(0, 16).replace("T", " "),
    String(t.requests),
    String(t.turns),
    pct(t.pctStrong),
    pct(100 * t.cacheReadRatio),
    usd(t.costUSD),
    usd(t.allStrongCostUSD),
    pct(t.savingsPct),
  ];
  const rows = [header, ...sessions.map(row), header.map(() => ""), row(total)];
  const widths = header.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  const lines = rows.map((r) => r.map((c, i) => (i < 2 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ").trimEnd());
  const reasons = Object.entries(total.reasons)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  lines.push("", `reasons: ${reasons || "(none)"}`);
  if (total.errors) lines.push(`errors: ${total.errors} request(s) failed (HTTP status >= 400 or an error event in the stream)`);
  return lines.join("\n");
}
