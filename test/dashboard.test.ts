import { mkdtempSync } from "node:fs";
import { appendFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type Config } from "../src/config.ts";
import type { DecisionLogLine } from "../src/log/decisions.ts";
import { buildDashboard } from "../src/dashboard/data.ts";
import { startDashboardServer } from "../src/dashboard/server.ts";

function logLine(overrides: Partial<DecisionLogLine> = {}): DecisionLogLine {
  return {
    ts: "2026-10-25T12:00:00.000Z",
    requestId: crypto.randomUUID(),
    sessionKey: "session-a",
    sessionKeySource: "prompt_cache_key",
    turnIndex: 0,
    isTurnStart: true,
    kind: "agent",
    requestedModel: "auto",
    tier: "weak",
    upstreamModel: "gpt-6-luna",
    reason: "heuristic:score=0[]",
    droppedReasoning: 0,
    responseId: "resp-1",
    status: 200,
    usage: null,
    costUSD: 0.01,
    allStrongCostUSD: 0.1,
    latencyMs: 100,
    ttftMs: 20,
    error: null,
    ...overrides,
  };
}

const servers: ReturnType<typeof startDashboardServer>[] = [];
const dirs: string[] = [];
function temporaryDir(): string {
  const dir = mkdtempSync("/tmp/opencode/asr-dashboard-test-");
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("dashboard data", () => {
  test("aggregates costs through report.aggregate and groups turn, routing, and daily views", () => {
    const lines = [
      logLine({
        ts: "2026-10-25T12:00:00.000Z", requestId: "r1", turnIndex: 0, isTurnStart: true,
        arm: "on", classifierTier: "strong", heuristicTier: "weak", classifierCostUSD: 0.002,
        turnPreview: "Investigate the race", reason: "classifier:strong", tier: "strong",
        costUSD: 0.02, allStrongCostUSD: 0.1, latencyMs: 100, ttftMs: 25,
      }),
      logLine({
        ts: "2026-10-25T12:00:02.000Z", requestId: "r2", turnIndex: 0, isTurnStart: false,
        arm: "on", classifierTier: "strong", heuristicTier: "weak", reason: "escalate:tool_errors=3",
        tier: "weak", costUSD: 0.01, allStrongCostUSD: 0.08, latencyMs: 300, ttftMs: 50,
      }),
      logLine({
        ts: "2026-10-25T13:00:00.000Z", requestId: "r3", turnIndex: 1, isTurnStart: true,
        arm: "on", classifierTier: "weak", heuristicTier: "weak", reason: "override:!weak",
        tier: "weak", costUSD: 0.005, allStrongCostUSD: 0.05, latencyMs: 50, ttftMs: null,
      }),
      logLine({
        ts: "2026-10-26T08:00:00.000Z", requestId: "r4", sessionKey: "session-b", turnIndex: 0,
        arm: "shadow", classifierTier: "weak", heuristicTier: "strong", reason: "heuristic:score=4[]",
        tier: "strong", classifierCostUSD: 0.003, turnPreview: "Rename this", status: 429,
        error: "capacity", costUSD: 0.03, allStrongCostUSD: 0.03, latencyMs: 700, ttftMs: 200,
      }),
      logLine({
        ts: "2026-10-26T09:00:00.000Z", requestId: "r5", sessionKey: null, turnIndex: null,
        isTurnStart: null, kind: null, tier: null, reason: null, status: 200,
        costUSD: null, allStrongCostUSD: null, latencyMs: 10, ttftMs: null,
      }),
    ];

    const data = buildDashboard(lines, new Date("2026-10-26T10:00:00Z"));
    expect(data.totals.requests).toBe(5);
    expect(data.coverage).toEqual({ unpricedRequests: 1, missingAllStrongRequests: 1 });
    expect(data.totals.turns).toBe(3);
    expect(data.totals.costUSD).toBeCloseTo(0.068);
    expect(data.totals.allStrongCostUSD).toBeCloseTo(0.26);
    expect(data.experiment.sessions).toEqual({ on: 1, shadow: 1 });
    expect(data.experiment.turns).toEqual({ on: 2, shadow: 1 });
    expect(data.experiment.agreement).toEqual({ matching: 1, compared: 3, rate: 1 / 3 });
    expect(data.experiment.disagreements).toHaveLength(2);
    expect(data.experiment.classifierCostUSD).toBeCloseTo(0.005);
    expect(data.routing.overrides["!weak"]).toBe(1);
    expect(data.routing.escalations).toBe(1);
    expect(data.routing.tiers.unknown).toBe(1);
    expect(data.trend[0]).toMatchObject({ date: "2026-10-25", requests: 3, turns: 2, sessions: 1, tiers: { weak: 2, strong: 1, unknown: 0 } });
    expect(data.trend[0]!.costUSD).toBeCloseTo(0.037);
    expect(data.trend[0]!.allStrongCostUSD).toBeCloseTo(0.23);
    expect(data.trend[1]).toMatchObject({ date: "2026-10-26", requests: 2, turns: 1, sessions: 1, tiers: { weak: 0, strong: 1, unknown: 1 } });
    expect(data.trend[1]!.costUSD).toBeCloseTo(0.033);
    for (const day of data.trend) {
      expect(day.tiers.weak + day.tiers.strong + day.tiers.unknown).toBe(day.requests);
    }
    const a = data.sessions.find((s) => s.sessionKey === "session-a")!;
    expect(a.tierSequence).toEqual(["strong", "weak"]);
    expect(a.tierFlips).toBe(0); // Previous turn finished weak; next turn started weak.
    expect(a.turnDetails[0]).toMatchObject({ tierSequence: ["strong", "weak"], internalTierFlips: 1, turnPreview: "Investigate the race" });
    expect(data.performance.byTier.weak).toMatchObject({ samples: 2, latencyMedianMs: 50, latencyP95Ms: 300, ttftSamples: 1, ttftMedianMs: 50, ttftP95Ms: 50 });
    expect(data.performance.errors).toBe(1);
    expect(data.performance.non200).toBe(1);
    expect(data.performance.statuses).toContainEqual({ status: 429, requests: 1 });
  });

  test("live timeline includes calls in the rolling hour in chronological order", () => {
    const data = buildDashboard([
      logLine({ requestId: "old", ts: "2026-10-26T10:59:59.999Z" }),
      logLine({ requestId: "boundary", ts: "2026-10-26T11:00:00.000Z", turnPreview: "private prompt" }),
      logLine({ requestId: "newest", ts: "2026-10-26T11:59:00.000Z", tier: "strong", classifierRaw: "private output" }),
      logLine({ requestId: "future", ts: "2026-10-26T12:01:00.000Z" }),
    ], new Date("2026-10-26T12:00:00.000Z"));
    expect(data.liveRequests).toHaveLength(2);
    expect(data.liveRequests).toMatchObject([
      { requestId: "boundary", ts: "2026-10-26T11:00:00.000Z", tier: "weak", reason: "heuristic:score=0[]", status: 200 },
      { requestId: "newest", ts: "2026-10-26T11:59:00.000Z", tier: "strong", reason: "heuristic:score=0[]", status: 200 },
    ]);
    for (const request of data.liveRequests) {
      expect(Object.keys(request).sort()).toEqual([
        "requestId", "ts", "sessionKey", "turnIndex", "tier", "reason", "upstreamModel", "costUSD", "latencyMs", "status", "error",
      ].sort());
      expect(request).not.toHaveProperty("turnPreview");
      expect(request).not.toHaveProperty("classifierRaw");
      expect(request).toMatchObject({ sessionKey: "session-a", turnIndex: 0, costUSD: 0.01, status: 200 });
    }
  });

  test("recent requests are newest first, limited to 80, and expose only ledger fields", () => {
    const lines = Array.from({ length: 85 }, (_, index) => logLine({
      requestId: `r${index.toString().padStart(3, "0")}`,
      ts: new Date(Date.UTC(2026, 9, 25, 12, 0, Math.floor(index / 2))).toISOString(),
      turnIndex: index,
      kind: index === 84 ? "title" : "agent",
      costUSD: index === 84 ? null : 0.01,
      classifierCostUSD: 0.002,
      turnPreview: "private user message",
      classifierRaw: "private classifier response",
    }));
    // Scramble input order; tied timestamps use the helper's request ID ordering.
    const input = [...lines.filter((_, index) => index % 2 === 0), ...lines.filter((_, index) => index % 2 !== 0)];
    const data = buildDashboard(input);
    expect(data.recentRequests).toHaveLength(80);
    expect(data.recentRequests.map((line) => line.requestId)).toEqual(
      Array.from({ length: 80 }, (_, index) => `r${(84 - index).toString().padStart(3, "0")}`),
    );
    const newest = lines[84]!;
    expect(data.recentRequests[0]).toEqual({
      requestId: newest.requestId,
      ts: newest.ts,
      sessionKey: newest.sessionKey,
      turnIndex: newest.turnIndex,
      kind: newest.kind,
      tier: newest.tier,
      reason: newest.reason,
      requestedModel: newest.requestedModel,
      upstreamModel: newest.upstreamModel,
      costUSD: null,
      latencyMs: newest.latencyMs,
      status: newest.status,
      error: newest.error,
    });
    for (const request of data.recentRequests) {
      expect(request).not.toHaveProperty("turnPreview");
      expect(request).not.toHaveProperty("classifierRaw");
      expect(request).not.toHaveProperty("classifierCostUSD");
    }
    expect(data.recentRequests[1]!.costUSD).toBe(0.01);
  });

  test("handles empty logs without inventing experiment or performance data", () => {
    const data = buildDashboard([]);
    expect(data.totals.requests).toBe(0);
    expect(data.coverage).toEqual({ unpricedRequests: 0, missingAllStrongRequests: 0 });
    expect(data.trend).toEqual([]);
    expect(data.experiment.agreement.rate).toBeNull();
    expect(data.experiment.choices).toEqual({ bothSmall: 0, bothStrong: 0, aiSmallRulesStrong: 0, aiStrongRulesSmall: 0 });
    expect(data.sessions).toEqual([]);
    expect(data.recentRequests).toEqual([]);
    expect(data.performance.byTier).toEqual({});
  });
});

test("experiment excludes historical/special requests and deduplicates tagged turn-starts", () => {
  const tagged = logLine({ arm: "on", classifierTier: "strong", heuristicTier: "weak", classifierCostUSD: 0.001 });
  const data = buildDashboard([
    logLine({ ts: "2026-10-03T00:00:00.000Z", sessionKey: "historical" }),
    tagged,
    logLine({ ...tagged, requestId: "retry", classifierCostUSD: undefined }),
    logLine({ ...tagged, sessionKey: "title", kind: "title", classifierCostUSD: undefined }),
    logLine({ ...tagged, sessionKey: "partial", isTurnStart: false, classifierCostUSD: undefined }),
    logLine({ ...tagged, sessionKey: null, classifierCostUSD: undefined }),
  ]);
  expect(data.experiment.sessions).toEqual({ on: 1, shadow: 0 });
  expect(data.experiment.turns).toEqual({ on: 1, shadow: 0 });
  expect(data.experiment.disagreements).toHaveLength(1);
  expect(data.experiment.agreement.compared).toBe(1);
  expect(data.experiment.choices).toEqual({ bothSmall: 0, bothStrong: 0, aiSmallRulesStrong: 0, aiStrongRulesSmall: 1 });
  expect(data.experiment.classifierCostUSD).toBeCloseTo(0.001);
});

test("experiment choices count only deduplicated turns with valid tier pairs", () => {
  const turn = (turnIndex: number, classifierTier: string, heuristicTier: string, overrides: Partial<DecisionLogLine> = {}) =>
    logLine({
      requestId: `choice-${turnIndex}`,
      turnIndex,
      arm: "on",
      // Parsed historical records may contain unsupported strings despite the log type.
      classifierTier: classifierTier as DecisionLogLine["classifierTier"],
      heuristicTier: heuristicTier as DecisionLogLine["heuristicTier"],
      ...overrides,
    });
  const bothSmall = turn(0, "weak", "weak");
  const bothStrong = turn(1, "strong", "strong");
  const aiSmallRulesStrong = turn(2, "weak", "strong");
  const aiStrongRulesSmall = turn(3, "strong", "weak");
  const data = buildDashboard([
    bothSmall,
    { ...bothSmall, requestId: "choice-0-retry" },
    bothStrong,
    aiSmallRulesStrong,
    aiStrongRulesSmall,
    turn(4, "unknown", "weak"),
    turn(5, "weak", "unset"),
    turn(6, "weak", "weak", { ts: "2026-10-03T00:00:00.000Z", arm: undefined }),
    turn(7, "weak", "weak", { kind: "title" }),
    turn(8, "weak", "weak", { isTurnStart: false }),
  ]);
  expect(data.experiment.turns).toEqual({ on: 6, shadow: 0 });
  expect(data.experiment.choices).toEqual({ bothSmall: 1, bothStrong: 1, aiSmallRulesStrong: 1, aiStrongRulesSmall: 1 });
  expect(data.experiment.agreement).toEqual({ matching: 2, compared: 4, rate: 0.5 });
  expect(data.experiment.disagreements).toHaveLength(2);
});

test("session labels use normalized chronological previews or stable fallbacks", () => {
  const filtered = [
    logLine({ sessionKey: "alpha", ts: "2026-10-26T12:00:00Z", turnIndex: 2, turnPreview: "Later message" }),
    logLine({ sessionKey: "blank", ts: "2026-10-26T12:01:00Z", turnIndex: 0, turnPreview: undefined }),
    logLine({ sessionKey: null, ts: "2026-10-26T12:02:00Z", turnIndex: null, kind: null }),
  ];
  const identity = [
    logLine({ sessionKey: "alpha", ts: "2026-10-25T12:00:00Z", turnIndex: 1, turnPreview: "   \n  First   \t conversation   " }),
    logLine({ sessionKey: "alpha", ts: "2026-10-24T12:00:00Z", turnIndex: 0, turnPreview: "  " }),
    logLine({ sessionKey: "long", ts: "2026-10-24T13:00:00Z", turnPreview: "x".repeat(90) }),
    logLine({ sessionKey: "blank", ts: "2026-10-24T14:00:00Z", turnPreview: " \n\t " }),
  ];
  const allIdentity = [...identity, ...filtered];
  const now = new Date("2026-10-26T13:00:00Z");
  const data = buildDashboard(filtered, now, allIdentity);
  const labels = Object.fromEntries(data.sessions.map((session) => [session.sessionKey, session.label]));
  expect(labels.alpha).toBe("First conversation");
  expect(labels.blank).toMatch(/^Conversation [0-9a-f]{6}$/);
  expect(labels["(none)"]).toBe("Unattributed calls");
  expect(data.totals.requests).toBe(filtered.length);
  expect(data.sessions.find((session) => session.sessionKey === "alpha")!.requests).toBe(1);

  const withoutLabels = (value: ReturnType<typeof buildDashboard>) => ({
    ...value,
    sessions: value.sessions.map(({ label, ...session }) => session),
  });
  expect(withoutLabels(data)).toEqual(withoutLabels(buildDashboard(filtered, now)));
  const reversed = buildDashboard([...filtered].reverse(), now, [...allIdentity].reverse());
  expect(reversed.sessions.map((session) => [session.sessionKey, session.label])).toEqual(
    data.sessions.map((session) => [session.sessionKey, session.label]),
  );
  expect(buildDashboard([filtered[1]!], now).sessions[0]!.label).toBe(labels.blank!);
  const otherFallback = buildDashboard([logLine({ sessionKey: "another-missing" })], now).sessions[0]!.label;
  expect(otherFallback).toMatch(/^Conversation [0-9a-f]{6}$/);
  expect(otherFallback).not.toBe(labels.blank!);
  const longLabel = buildDashboard([identity[2]!]).sessions[0]!.label;
  expect(longLabel).toHaveLength(72);
  expect(longLabel.endsWith("…")).toBe(true);
  expect(buildDashboard([filtered[0]!], now, allIdentity).sessions[0]!.label).toBe(labels.alpha!);
  expect(buildDashboard(allIdentity, now).sessions.find((session) => session.sessionKey === "alpha")!.label).toBe(labels.alpha!);
  const malformedPreview = logLine({ turnPreview: 123 as unknown as string });
  expect(buildDashboard([malformedPreview]).sessions[0]!.label).toMatch(/^Conversation [0-9a-f]{6}$/);
});

test("turn order and tier flips are chronological, distinct from within-turn switches", () => {
  const data = buildDashboard([
    logLine({ turnIndex: 2, ts: "2026-10-25T14:00:00Z", tier: "strong" }),
    logLine({ turnIndex: 0, ts: "2026-10-25T12:00:00Z", tier: "weak" }),
    logLine({ turnIndex: 1, ts: "2026-10-25T13:00:00Z", tier: "strong" }),
    logLine({ turnIndex: 2, ts: "2026-10-25T14:01:00Z", tier: "weak", isTurnStart: false }),
  ]);
  expect(data.sessions[0]!.tierSequence).toEqual(["weak", "strong", "strong"]);
  expect(data.sessions[0]!.tierFlips).toBe(1);
  expect(data.sessions[0]!.turnDetails[2]!.internalTierFlips).toBe(1);
});

test("errors include in-stream HTTP 200 failures, and null durations are excluded", () => {
  const data = buildDashboard([
    logLine({ error: "stream error", latencyMs: 0, ttftMs: null }),
    logLine({ status: 302, tier: null, latencyMs: 20, ttftMs: 0 }),
  ]);
  expect(data.performance.errors).toBe(1);
  expect(data.performance.non200).toBe(1);
  expect(data.performance.failures).toHaveLength(2);
  expect(data.performance.byTier.weak!.ttftMedianMs).toBeNull();
  expect(data.performance.byTier.unknown!.ttftMedianMs).toBe(0);
});

test("dashboard server is loopback-only and picks up appended log records", async () => {
  const dir = temporaryDir();
  const path = join(dir, "decisions.jsonl");
  await writeFile(path, JSON.stringify(logLine({ requestId: "first" })) + "\n");
  const cfg: Config = {
    ...DEFAULT_CONFIG,
    log: { ...DEFAULT_CONFIG.log, path },
  };
  const server = startDashboardServer(cfg, { port: 0 });
  servers.push(server);

  const first = await fetch(`http://127.0.0.1:${server.port}/api/dashboard`);
  expect(first.status).toBe(200);
  expect(first.headers.get("cache-control")).toBe("no-store");
  expect((await first.json() as any).totals.requests).toBe(1);

  await appendFile(path, JSON.stringify(logLine({ requestId: "second", ts: "2026-10-25T12:01:00.000Z", turnIndex: 1 })) + "\n");
  const second = await fetch(`http://127.0.0.1:${server.port}/api/dashboard`);
  expect((await second.json() as any).totals.requests).toBe(2);

  const spoofed = await fetch(`http://127.0.0.1:${server.port}/api/dashboard`, {
    headers: { host: `example.com:${server.port}` },
  });
  expect(spoofed.status).toBe(403);
  const origin = await fetch(`http://127.0.0.1:${server.port}/api/dashboard`, {
    headers: { origin: "https://foreign.example" },
  });
  expect(origin.status).toBe(403);
  const post = await fetch(`http://127.0.0.1:${server.port}/api/dashboard`, { method: "POST" });
  expect(post.status).toBe(405);
  const page = await fetch(`http://127.0.0.1:${server.port}/`);
  expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  const html = await page.text();
  expect(html).toContain("setInterval(refresh,1000)");
  expect(html).not.toMatch(/<(script|link)[^>]+(?:src|href)=/);
  expect(html).not.toContain("innerHTML");
  const markup = html.split("<script>")[0]!;
  expect(markup).toMatch(/color-scheme:\s*dark/);
  expect(markup).toContain('data-view="spending"');
  expect(markup).toContain('id="live-chart"');
   expect(markup).toContain('id="live-window"');
   expect(markup).toContain('value="5" selected>5 min');
   expect(markup).toContain('id="cumulative-chart"');
  expect(markup).toContain('id="overview-choice-grid"');
  expect(markup).toContain('id="activity-chart"');
  expect(markup).not.toContain('id="history-disclosure"');
  expect(markup).toContain("AI-selected conversations");
  expect(markup).toContain("Rule-selected conversations");
  expect(markup).not.toMatch(/Arm:\s*(on|shadow)/i);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeDefined();
  expect(() => new Function(script!)).not.toThrow();
});

test("live timeline advances existing markers and expires calls without new log data", async () => {
  const html = await Bun.file(new URL("../src/dashboard/index.html", import.meta.url)).text();
  const body = html.match(/function advanceLiveTimeline\(\) \{([\s\S]*?)\n    \}\n\n    function renderLive\(/)?.[1];
  expect(body).toBeDefined();
  expect(html).toContain("setInterval(advanceLiveTimeline, 100)");
  let now = 300_000;
  const count = { textContent: "" };
  const marker = { x: 0, removed: false, setAttribute(_key: string, x: number) { this.x = x; }, remove() { this.removed = true; } };
  const label = { textContent: "" };
  const timeline = {
    minutes: 5, width: 340, left: 14, right: 14,
    ticks: [{ label, fraction: 1 }],
    markers: [{ marker, ts: 150_000, tier: "strong" }],
    empty: { style: { display: "" } },
  };
  const tick = new Function("liveTimeline", "activeView", "document", "liveNow", "number", "$", "positionLiveTooltip", body!);
  const advance = () => tick(timeline, "live", { hidden: false }, () => now, String, () => count, () => {});
  advance();
  const firstX = marker.x;
  const firstLabel = label.textContent;
  expect(count.textContent).toBe("1 calls · 0 Small · 1 Strong");
  now += 10_000;
  advance();
  expect(marker.x).toBeLessThan(firstX);
  expect(label.textContent).not.toBe(firstLabel);
  expect(timeline.markers[0]!.marker).toBe(marker);
  expect(marker.removed).toBe(false);
  now = 450_001;
  advance();
  expect(marker.removed).toBe(true);
  expect(timeline.markers).toHaveLength(0);
  expect(count.textContent).toBe("0 calls · 0 Small · 0 Strong");
  expect(timeline.empty.style.display).toBe("");
});

test("live dots show immediate, safely rendered tooltips on hover and focus", async () => {
  const html = await Bun.file(new URL("../src/dashboard/index.html", import.meta.url)).text();
  const functions = html.match(/    function hideLiveTooltip\(\) \{([\s\S]*?)    function renderLive\(data\)/)?.[0].replace(/    function renderLive\(data\)$/, "");
  expect(functions).toBeDefined();
  // Execute the production timeline/tooltip functions with a small DOM stand-in.
  class Node {
    children: Node[] = [];
    dataset: Record<string, string> = {};
    style: Record<string, string> = {};
    attrs: Record<string, any> = {};
    events: Record<string, (event: any) => void> = {};
    hidden = true;
    textContent = "";
    clientWidth = 550;
    value = "5";
    rect = { left: 480, top: 50, bottom: 58, width: 8, height: 8 };
    constructor(public tag = "div", text?: unknown) { if (text != null) this.textContent = String(text); }
    append(...nodes: Node[]) { this.children.push(...nodes); }
    replaceChildren(...nodes: Node[]) { this.children = nodes; }
    setAttribute(key: string, value: any) { this.attrs[key] = value; }
    getBoundingClientRect() { return this.rect; }
    addEventListener(name: string, listener: (event: any) => void) { this.events[name] = listener; }
    contains(node: Node | null): boolean { return node === this || this.children.some((child) => child.contains(node)); }
    remove() { this.attrs.removed = true; }
    text(): string { return [this.textContent, ...this.children.map((child) => child.text())].join(" "); }
  }
  const tooltip = new Node();
  tooltip.rect = { left: 0, top: 0, bottom: 170, width: 300, height: 170 };
  const chart = new Node("svg");
  const nodes: Record<string, Node> = { "live-chart": chart, "live-window": new Node(), "live-tooltip": tooltip, "live-count": new Node() };
  let now = 300_000;
  const document = { hidden: false };
  const domNode = (tag: string, text?: unknown) => new Node(tag, text);
  const svgNode = (tag: string, attrs: Record<string, unknown>, text?: unknown) => {
    const node = new Node(tag, text);
    node.attrs = attrs;
    return node;
  };
  const create = new Function("$", "document", "window", "liveNow", "el", "svgNode", "tierLabel", "time", "reasonLabel", "conversationLabel", "duration", "money", "number", "tierName", `
    let liveTooltipRequestId = null, liveTimeline = null, activeView = 'live';
    const freshLiveRequests = new Set();
    ${functions}
    return { renderLiveTimeline, advanceLiveTimeline, positionLiveTooltip, hideLiveTooltip };
  `);
  const ui = create((id: string) => nodes[id], document, { innerWidth: 500, innerHeight: 400 }, () => now,
    domNode, svgNode, (tier: string) => new Node("span", tier), String, (reason: string) => "Reason: " + reason,
    () => "Conversation <img src=x onerror=alert(1)>", (n: unknown) => `${n} ms`, (n: number) => `$${n.toFixed(4)}`, String, String);
  const request = {
    requestId: "one", ts: new Date(150_000).toISOString(), tier: "strong", reason: "classifier:strong", status: 200,
    upstreamModel: "test-model", turnIndex: 2, sessionKey: "s", costUSD: 0.01, latencyMs: 123,
    error: "<script>alert(1)</script>",
  };
  const marker = () => chart.children.find((node) => node.tag === "circle")!;
  ui.renderLiveTimeline({ liveRequests: [request] });
  expect(tooltip.hidden).toBe(true);
  expect(marker().children).toHaveLength(0); // No delayed native SVG title.
  expect(marker().attrs.r).toBe(7);
  expect(html).toContain("stroke-width: 18px; pointer-events: all");
  expect(marker().attrs["aria-describedby"]).toBe("live-tooltip");
  marker().events.pointerenter!({});
  expect(tooltip.hidden).toBe(false); // Synchronous: no timer or extra fetch.
  expect(tooltip.text()).toContain("test-model");
  expect(tooltip.text()).toContain("classifier:strong");
  expect(tooltip.text()).toContain("Message 2 · 123 ms · HTTP 200");
  expect(tooltip.text()).toContain("$0.0100 call cost (excludes selection fee)");
  expect(tooltip.text()).toContain("Conversation <img src=x onerror=alert(1)>");
  expect(tooltip.text()).toContain("<script>alert(1)</script>");
  expect(tooltip.children.every((node) => !["img", "script"].includes(node.tag))).toBe(true);
  expect(tooltip.style.left).toBe("192px"); // Clamped to the right viewport edge.
  expect(tooltip.style.top).toBe("58px"); // Flips below a dot near the top.
  marker().events.pointerleave!({ relatedTarget: tooltip });
  expect(tooltip.hidden).toBe(false); // Popup remains readable when hovered.
  marker().events.pointerleave!({ relatedTarget: null });
  expect(tooltip.hidden).toBe(true);
  marker().events.focus!({});
  expect(tooltip.hidden).toBe(false);
  ui.renderLiveTimeline({ liveRequests: [request] });
  expect(tooltip.hidden).toBe(false); // Polling rebuild retains the selected request.
  marker().events.blur!({ relatedTarget: null });
  expect(tooltip.hidden).toBe(true);
  marker().events.focus!({});
  now = 450_001;
  ui.advanceLiveTimeline();
  expect(tooltip.hidden).toBe(true); // Expired dots cannot leave stale popups.
  now = 300_000;
  ui.renderLiveTimeline({ liveRequests: [{ ...request, costUSD: null, upstreamModel: null, turnIndex: null, error: null, tier: null }] });
  marker().events.focus!({});
  expect(tooltip.text()).toContain("Cost not recorded");
  expect(tooltip.text()).toContain("Model not recorded");
  expect(tooltip.text()).toContain("Message not recorded");
  document.hidden = true;
  ui.positionLiveTooltip();
  expect(tooltip.hidden).toBe(true);
  expect(html).toContain("if (event.key === 'Escape') hideLiveTooltip()");
});

test("date filters retain conversation labels but exclude old metrics and messages", async () => {
  const path = join(temporaryDir(), "decisions.jsonl");
  const cfg = { ...DEFAULT_CONFIG, log: { ...DEFAULT_CONFIG.log, path } };
  const old = logLine({ ts: "2020-01-01T12:00:00Z", turnIndex: 0, turnPreview: "Fix the login redirect", costUSD: 99 });
  const recent = logLine({ ts: new Date().toISOString(), turnIndex: 1, turnPreview: "Now add a test", costUSD: 0.01 });
  await writeFile(path, [old, recent].map((line) => JSON.stringify(line)).join("\n"));
  const server = startDashboardServer(cfg, { port: 0 });
  servers.push(server);
  const data = await (await fetch(`http://127.0.0.1:${server.port}/api/dashboard?range=24h`)).json() as any;
  expect(data.totals.requests).toBe(1);
  expect(data.totals.costUSD).toBeCloseTo(0.01);
  expect(data.sessions[0].label).toBe("Fix the login redirect");
  expect(data.sessions[0].turnDetails).toHaveLength(1);
  expect(data.sessions[0].turnDetails[0].turnPreview).toBe("Now add a test");
  expect(data.trend).toHaveLength(1);
});

test("missing file, partial writes, truncation, date filtering, and hostile previews", async () => {
  const path = join(temporaryDir(), "decisions.jsonl");
  const cfg = { ...DEFAULT_CONFIG, log: { ...DEFAULT_CONFIG.log, path } };
  const server = startDashboardServer(cfg, { port: 0 });
  servers.push(server);
  const url = `http://127.0.0.1:${server.port}`;
  let data = await (await fetch(url + "/api/dashboard")).json() as any;
  expect(data.logAvailable).toBe(false);
  expect(data.totals.requests).toBe(0);
  const preview = '<script>fetch("https://evil.example")</script>';
  await writeFile(path, JSON.stringify(logLine({ ts: new Date().toISOString(), turnPreview: preview })) + '\n{"ts":');
  data = await (await fetch(url + "/api/dashboard?range=24h")).json() as any;
  expect(data.logAvailable).toBe(true);
  expect(data.totals.requests).toBe(1);
  expect(data.sessions[0].turnDetails[0].turnPreview).toBe(preview);
  await writeFile(path, JSON.stringify(logLine()) + '\nnull\n{}\n');
  data = await (await fetch(url + "/api/dashboard")).json() as any;
  expect(data.logAvailable).toBe(true);
  expect(data.totals.requests).toBe(1);
  expect(data.invalidRecords).toBe(2);
  const html = await (await fetch(url + "/")).text();
  expect(html).not.toContain(preview);
  await writeFile(path, JSON.stringify(logLine({ ts: "2026-10-03T00:00:00Z" })) + "\n");
  data = await (await fetch(url + "/api/dashboard?range=24h")).json() as any;
  expect(data.totals.requests).toBe(0);
  await writeFile(path, "");
  data = await (await fetch(url + "/api/dashboard")).json() as any;
  expect(data.totals.requests).toBe(0);
});
