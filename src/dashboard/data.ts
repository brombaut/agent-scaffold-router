import type { DecisionLogLine } from "../log/decisions.ts";
import { aggregate, type Totals } from "../report.ts";

export interface DashboardTurn {
  turnIndex: number;
  startedAt: string;
  tier: string;
  tierSequence: string[];
  internalTierFlips: number;
  reason: string;
  arm?: "on" | "shadow";
  classifierTier?: string;
  heuristicTier?: string;
  turnPreview?: string;
  costUSD: number;
  requests: number;
  errors: number;
}

export interface DashboardSession extends Totals {
  label: string;
  tierFlips: number;
  tierSequence: string[];
  turnDetails: DashboardTurn[];
}

export interface DashboardData {
  generatedAt: string;
  totals: Totals;
  coverage: { unpricedRequests: number; missingAllStrongRequests: number };
  trend: Array<{
    date: string;
    requests: number;
    turns: number;
    sessions: number;
    costUSD: number;
    allStrongCostUSD: number;
    tiers: { weak: number; strong: number; unknown: number };
  }>;
  routing: {
    tiers: Record<string, number>;
    reasons: Array<{ reason: string; requests: number }>;
    overrides: Record<string, number>;
    escalations: number;
  };
  experiment: {
    sessions: Record<string, number>;
    turns: Record<string, number>;
    choices: { bothSmall: number; bothStrong: number; aiSmallRulesStrong: number; aiStrongRulesSmall: number };
    agreement: { matching: number; compared: number; rate: number | null };
    disagreements: Array<{
      sessionKey: string;
      turnIndex: number;
      ts: string;
      classifierTier: string;
      heuristicTier: string;
      routedTier: string;
      arm: "on" | "shadow";
      reason: string;
      turnPreview: string;
    }>;
    classifierCostUSD: number;
  };
  sessions: DashboardSession[];
  liveRequests: Array<Pick<DecisionLogLine, "requestId" | "ts" | "tier" | "reason" | "status">>;
  recentRequests: Array<Pick<DecisionLogLine, "requestId" | "ts" | "sessionKey" | "turnIndex" | "kind" | "tier" | "reason" | "requestedModel" | "upstreamModel" | "costUSD" | "latencyMs" | "status" | "error">>;
  performance: {
    byTier: Record<string, { samples: number; latencyMedianMs: number | null; latencyP95Ms: number | null; ttftSamples: number; ttftMedianMs: number | null; ttftP95Ms: number | null }>;
    statuses: Array<{ status: number; requests: number }>;
    errors: number;
    non200: number;
    failures: Array<Pick<DecisionLogLine, "ts" | "sessionKey" | "turnIndex" | "tier" | "status" | "error" | "requestId">>;
  };
}

function grouped<T>(lines: DecisionLogLine[], keyOf: (line: DecisionLogLine) => string | null): Map<string, DecisionLogLine[]> {
  const out = new Map<string, DecisionLogLine[]>();
  for (const line of lines) {
    const key = keyOf(line);
    if (key === null) continue;
    const group = out.get(key) ?? [];
    group.push(line);
    out.set(key, group);
  }
  return out;
}

function turnKey(line: DecisionLogLine): string | null {
  return line.sessionKey !== null && line.turnIndex !== null && line.kind === "agent"
    ? `${line.sessionKey}\u0000${line.turnIndex}`
    : null;
}

function sortedLines(lines: DecisionLogLine[]): DecisionLogLine[] {
  return [...lines].sort((a, b) => a.ts.localeCompare(b.ts) || a.requestId.localeCompare(b.requestId));
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(p * sorted.length) - 1]!;
}

function durationStats(values: number[]) {
  return { medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95) };
}

function conversationLabel(sessionKey: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < sessionKey.length; i++) {
    hash = Math.imul(hash ^ sessionKey.charCodeAt(i), 0x01000193);
  }
  return `Conversation ${(`00000000${(hash >>> 0).toString(16)}`).slice(-6)}`;
}

function sessionLabels(lines: DecisionLogLine[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const line of sortedLines(lines)) {
    if (line.sessionKey === null || labels.has(line.sessionKey) || typeof line.turnPreview !== "string") continue;
    const preview = line.turnPreview.replace(/\s+/g, " ").trim();
    if (!preview) continue;
    labels.set(line.sessionKey, preview.length > 72 ? `${preview.slice(0, 71)}…` : preview);
  }
  return labels;
}

/** Build dashboard views from parsed log records. Cost totals are delegated to report.aggregate. */
export function buildDashboard(lines: DecisionLogLine[], now = new Date(), identityLines: DecisionLogLine[] = lines): DashboardData {
  const { sessions: reportSessions, total } = aggregate(lines);
  const days = grouped(lines, (line) => line.ts.slice(0, 10));
  const trend = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, dayLines]) => {
    const dayTotal = aggregate(dayLines).total;
    const tiers = { weak: 0, strong: 0, unknown: 0 };
    for (const line of dayLines) {
      const tier = line.tier === "weak" || line.tier === "strong" ? line.tier : "unknown";
      tiers[tier]++;
    }
    return {
      date,
      requests: dayTotal.requests,
      turns: dayTotal.turns,
      sessions: new Set(dayLines.map((line) => line.sessionKey).filter((key): key is string => key !== null)).size,
      costUSD: dayTotal.costUSD,
      allStrongCostUSD: dayTotal.allStrongCostUSD,
      tiers,
    };
  });

  const tiers: Record<string, number> = {};
  const reasons = new Map<string, number>();
  const overrides: Record<"!strong" | "!weak", number> = { "!strong": 0, "!weak": 0 };
  let escalations = 0;
  const statusCounts = new Map<number, number>();
  let errors = 0;
  let non200 = 0;
  const perf = new Map<string, { latency: number[]; ttft: number[] }>();
  for (const line of lines) {
    const tier = line.tier ?? "unknown";
    tiers[tier] = (tiers[tier] ?? 0) + 1;
    const reason = line.reason ?? "none";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    if (reason.startsWith("override:!strong")) overrides["!strong"]++;
    if (reason.startsWith("override:!weak")) overrides["!weak"]++;
    if (reason.startsWith("escalate:")) escalations++;
    statusCounts.set(line.status, (statusCounts.get(line.status) ?? 0) + 1);
    if (line.status !== 200) non200++;
    if (line.status >= 400 || line.error) errors++;
    const stats = perf.get(tier) ?? { latency: [], ttft: [] };
    if (Number.isFinite(line.latencyMs)) stats.latency.push(line.latencyMs);
    if (line.ttftMs !== null && Number.isFinite(line.ttftMs)) stats.ttft.push(line.ttftMs);
    perf.set(tier, stats);
  }

  const turnGroups = grouped(lines, turnKey);
  const turnsBySession = new Map<string, DashboardTurn[]>();
  for (const turnLines of turnGroups.values()) {
    const ordered = sortedLines(turnLines);
    const first = ordered[0]!;
    const tierSequence = ordered.reduce<string[]>((out, line) => {
      const tier = line.tier ?? "unknown";
      if (out.at(-1) !== tier) out.push(tier);
      return out;
    }, []);
    const turn = aggregate(ordered).total;
    const detail: DashboardTurn = {
      turnIndex: first.turnIndex!,
      startedAt: first.ts,
      tier: tierSequence[0] ?? "unknown",
      tierSequence,
      internalTierFlips: Math.max(0, tierSequence.length - 1),
      reason: first.reason ?? "none",
      costUSD: turn.costUSD,
      requests: turn.requests,
      errors: turn.errors,
      ...(first.arm ? { arm: first.arm } : {}),
      ...(first.classifierTier ? { classifierTier: first.classifierTier } : {}),
      ...(first.heuristicTier ? { heuristicTier: first.heuristicTier } : {}),
      ...(first.turnPreview ? { turnPreview: first.turnPreview } : {}),
    };
    if (first.sessionKey !== null) {
      const existing = turnsBySession.get(first.sessionKey) ?? [];
      existing.push(detail);
      turnsBySession.set(first.sessionKey, existing);
    }
  }

  const labels = sessionLabels(identityLines);
  const sessions: DashboardSession[] = reportSessions.map((summary) => {
    const turnDetails = (turnsBySession.get(summary.sessionKey) ?? []).sort((a, b) => a.turnIndex - b.turnIndex || a.startedAt.localeCompare(b.startedAt));
    const tierSequence = turnDetails.map((turn) => turn.tier);
    let tierFlips = 0;
    for (let i = 1; i < turnDetails.length; i++) {
      const previousTier = turnDetails[i - 1]!.tierSequence.at(-1);
      if (turnDetails[i]!.tier !== previousTier) tierFlips++;
    }
    const label = summary.sessionKey === "(none)" ? "Unattributed calls" : labels.get(summary.sessionKey) ?? conversationLabel(summary.sessionKey);
    return { ...summary, label, tierFlips, tierSequence, turnDetails };
  }).sort((a, b) => b.lastTs.localeCompare(a.lastTs));

  const taggedTurns = [...turnGroups.values()].map(sortedLines).map((turnLines) => turnLines.find((line) => line.isTurnStart && line.arm));
  const experimentLines = taggedTurns.filter((line): line is DecisionLogLine & { arm: "on" | "shadow" } => Boolean(line && line.kind === "agent"));
  const armSessions: Record<"on" | "shadow", Set<string>> = { on: new Set(), shadow: new Set() };
  const armTurns: Record<"on" | "shadow", number> = { on: 0, shadow: 0 };
  let matching = 0;
  let compared = 0;
  const choices = { bothSmall: 0, bothStrong: 0, aiSmallRulesStrong: 0, aiStrongRulesSmall: 0 };
  const disagreements: DashboardData["experiment"]["disagreements"] = [];
  for (const line of experimentLines) {
    armTurns[line.arm]++;
    if (line.sessionKey !== null) armSessions[line.arm].add(line.sessionKey);
    const { classifierTier, heuristicTier } = line;
    if ((classifierTier === "weak" || classifierTier === "strong") && (heuristicTier === "weak" || heuristicTier === "strong")) {
      compared++;
      if (line.classifierTier === "weak" && line.heuristicTier === "weak") choices.bothSmall++;
      else if (line.classifierTier === "strong" && line.heuristicTier === "strong") choices.bothStrong++;
      else if (line.classifierTier === "weak") choices.aiSmallRulesStrong++;
      else choices.aiStrongRulesSmall++;
      if (line.classifierTier === line.heuristicTier) matching++;
      else disagreements.push({
        sessionKey: line.sessionKey ?? "(none)",
        turnIndex: line.turnIndex ?? -1,
        ts: line.ts,
        classifierTier,
        heuristicTier,
        routedTier: line.tier ?? "unknown",
        arm: line.arm,
        reason: line.reason ?? "none",
        turnPreview: line.turnPreview ?? "",
      });
    }
  }
  // report.aggregate owns all cost accounting. Subtract the same totals with classifier costs
  // omitted to isolate the classifier portion without duplicating its cost rules.
  const withoutClassifierCosts = lines.map((line) => ({ ...line, classifierCostUSD: undefined }));
  const classifierCost = total.costUSD - aggregate(withoutClassifierCosts).total.costUSD;

  const byTier: DashboardData["performance"]["byTier"] = {};
  for (const [tier, stats] of perf) {
    const latency = durationStats(stats.latency);
    const ttft = durationStats(stats.ttft);
    byTier[tier] = {
      samples: stats.latency.length,
      latencyMedianMs: latency.medianMs,
      latencyP95Ms: latency.p95Ms,
      ttftSamples: stats.ttft.length,
      ttftMedianMs: ttft.medianMs,
      ttftP95Ms: ttft.p95Ms,
    };
  }

  return {
    generatedAt: now.toISOString(),
    totals: total,
    coverage: {
      unpricedRequests: lines.filter((line) => line.costUSD === null).length,
      missingAllStrongRequests: lines.filter((line) => line.allStrongCostUSD === null).length,
    },
    trend,
    routing: {
      tiers,
      reasons: [...reasons].map(([reason, requests]) => ({ reason, requests })).sort((a, b) => b.requests - a.requests),
      overrides,
      escalations,
    },
    experiment: {
      sessions: { on: armSessions.on.size, shadow: armSessions.shadow.size },
      turns: armTurns,
      choices,
      agreement: { matching, compared, rate: compared ? matching / compared : null },
      disagreements: disagreements.sort((a, b) => a.ts.localeCompare(b.ts)),
      classifierCostUSD: classifierCost,
    },
    sessions,
    liveRequests: sortedLines(lines).filter((line) => {
      const ts = Date.parse(line.ts);
      return ts >= now.getTime() - 60 * 60 * 1000 && ts <= now.getTime();
    }).map(
      ({ requestId, ts, tier, reason, status }) => ({ requestId, ts, tier, reason, status }),
    ),
    recentRequests: sortedLines(lines).reverse().slice(0, 80).map(
      ({ requestId, ts, sessionKey, turnIndex, kind, tier, reason, requestedModel, upstreamModel, costUSD, latencyMs, status, error }) =>
        ({ requestId, ts, sessionKey, turnIndex, kind, tier, reason, requestedModel, upstreamModel, costUSD, latencyMs, status, error }),
    ),
    performance: {
      byTier,
      statuses: [...statusCounts].map(([status, requests]) => ({ status, requests })).sort((a, b) => a.status - b.status),
      errors,
      non200,
      failures: sortedLines(lines.filter((line) => line.status !== 200 || line.error)).reverse().map(
        ({ ts, sessionKey, turnIndex, tier, status, error, requestId }) => ({ ts, sessionKey, turnIndex, tier, status, error, requestId }),
      ),
    },
  };
}
