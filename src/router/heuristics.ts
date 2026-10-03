import type { Policy, TierName } from "../config.ts";

export interface HeuristicResult {
  tier: TierName;
  score: number;
  signals: string[];
  reason: string;
}

const FILE_PATH_RE = /[\w./-]+\.\w{1,5}/g;
const FENCE_RE = /```[^\n]*\n([\s\S]*?)```/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPhrase(text: string, phrase: string): boolean {
  return new RegExp(`\\b${escapeRe(phrase)}\\b`, "i").test(text);
}

/** Scores the latest user message; see the spec's heuristic table. */
export function scoreMessage(text: string, policy: Policy): HeuristicResult {
  let score = 0;
  const signals: string[] = [];

  if (text.length > 2000) {
    score += 2;
    signals.push("len>2000");
  }

  const strongHits = policy.keywords.strong.filter((k) => containsPhrase(text, k));
  for (const k of strongHits.slice(0, 2)) {
    score += 2;
    signals.push(`keyword:${k}`);
  }

  const paths = new Set(text.match(FILE_PATH_RE) ?? []);
  if (paths.size >= 3) {
    score += 1;
    signals.push(`files=${paths.size}`);
  }

  for (const m of text.matchAll(FENCE_RE)) {
    if ((m[1] ?? "").split("\n").length > 50) {
      score += 1;
      signals.push("code>50");
      break;
    }
  }

  const weakHits = policy.keywords.weak.filter((k) => containsPhrase(text, k));
  for (const k of weakHits.slice(0, 2)) {
    score -= 1;
    signals.push(`weak:${k}`);
  }

  const tier: TierName = score >= policy.strongThreshold ? "strong" : "weak";
  return { tier, score, signals, reason: `heuristic:score=${score}[${signals.join(",")}]` };
}
