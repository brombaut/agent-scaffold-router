import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { costUSD } from "../src/log/cost.ts";
import type { DecisionLogLine } from "../src/log/decisions.ts";
import { aggregate, formatReport, parseLog } from "../src/report.ts";

const { strong, weak } = DEFAULT_CONFIG.tiers;

describe("costUSD", () => {
  test("plain input and output", () => {
    expect(costUSD({ input: 1_000_000, cachedRead: 0, cacheWrite: 0, output: 1_000_000, reasoning: 0 }, strong.price)).toBeCloseTo(12);
  });

  test("cached reads and cache writes are billed at their own rates", () => {
    const u = { input: 1_000_000, cachedRead: 600_000, cacheWrite: 300_000, output: 0, reasoning: 0 };
    // 100k fresh * $2 + 600k * $0.10 + 300k * $2.50
    expect(costUSD(u, strong.price)).toBeCloseTo(0.2 + 0.06 + 0.75);
  });

  test("counterfactual: weak usage priced at strong rates", () => {
    const u = { input: 18_000, cachedRead: 0, cacheWrite: 0, output: 100, reasoning: 0 };
    expect(costUSD(u, strong.price) / costUSD(u, weak.price)).toBeCloseTo(20);
  });
});

function line(over: Partial<DecisionLogLine>): DecisionLogLine {
  return {
    ts: "2026-10-03T00:00:00.000Z",
    requestId: "r",
    sessionKey: "ses_a",
    sessionKeySource: "prompt_cache_key",
    turnIndex: 1,
    isTurnStart: true,
    kind: "agent",
    requestedModel: "auto",
    tier: "weak",
    upstreamModel: weak.model,
    reason: "heuristic:score=0[]",
    droppedReasoning: 0,
    responseId: null,
    status: 200,
    usage: { input: 100, cachedRead: 50, cacheWrite: 0, output: 10, reasoning: 0 },
    costUSD: 0.1,
    allStrongCostUSD: 1,
    latencyMs: 10,
    ttftMs: 5,
    error: null,
    ...over,
  };
}

describe("report", () => {
  const lines = [
    line({}),
    line({ isTurnStart: false, reason: "heuristic:score=0[]" }),
    line({ tier: "strong", costUSD: 1, allStrongCostUSD: 1, reason: "escalate:tool_errors=3", isTurnStart: false }),
    line({ sessionKey: "ses_b", ts: "2026-10-03T01:00:00.000Z", kind: "title", reason: "title" }),
    line({ sessionKey: "ses_b", ts: "2026-10-03T01:00:01.000Z", status: 429, usage: null, costUSD: null, allStrongCostUSD: null }),
    line({ sessionKey: "ses_b", ts: "2026-10-03T01:00:02.000Z", usage: null, costUSD: null, allStrongCostUSD: null, error: '{"message":"high demand"}' }),
  ];

  test("aggregates per session and in total", () => {
    const { sessions, total } = aggregate(lines);
    expect(sessions.map((s) => s.sessionKey)).toEqual(["ses_a", "ses_b"]);
    const a = sessions[0]!;
    expect(a.requests).toBe(3);
    expect(a.turns).toBe(1);
    expect(a.pctStrong).toBeCloseTo(100 / 3);
    expect(a.cacheReadRatio).toBeCloseTo(0.5);
    expect(a.costUSD).toBeCloseTo(1.2);
    expect(a.allStrongCostUSD).toBeCloseTo(3);
    expect(a.savingsPct).toBeCloseTo(60);
    expect(total.requests).toBe(6);
    expect(total.errors).toBe(2);
    expect(total.reasons).toEqual({ heuristic: 4, escalate: 1, title: 1 });
  });

  test("formats a table with a total row", () => {
    const text = formatReport(aggregate(lines));
    expect(text).toContain("ses_a");
    expect(text).toContain("TOTAL");
    expect(text).toContain("reasons: heuristic 4");
    expect(text).toContain("errors: 2");
  });

  test("parseLog skips blank and partial lines", () => {
    const text = JSON.stringify(line({})) + "\n\n" + '{"ts":"2026-10-03T0';
    expect(parseLog(text)).toHaveLength(1);
  });
});
