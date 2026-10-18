import type { Config, TierName } from "../config.ts";
import { costUSD } from "../log/cost.ts";
import { parseUsage, type Usage } from "../sse.ts";

/**
 * Turn-start classifier (spec 003). Written once and kept general on purpose;
 * don't tune its wording against eval results.
 */
export const CLASSIFIER_INSTRUCTIONS = `You route requests from a user to a coding agent. Two models can do the work:
- small: fast and cheap. It handles most everyday coding well, but it gets harder tasks wrong, for example ones that need careful reasoning over many cases and edge cases, a non-obvious algorithm, subtle bugs, or a design spanning several parts. When it is wrong it usually does not notice.
- large: much more reliable on hard tasks, but about 15 times the cost.

Read the user's message and decide which model should handle it. Answer with exactly one word: "weak" if the small model will very likely get it fully right, otherwise "strong".`;

export interface Classification {
  tier: TierName;
  /** The model's answer, or the error, for the log. */
  raw: string;
  usage: Usage | null;
  costUSD: number;
}

/**
 * Asks `model` (a tier) whether `text` needs the strong tier. Any failure or
 * unclear answer gives strong, like every other routing failure.
 */
export async function classify(
  text: string,
  model: TierName,
  cfg: Config,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<Classification> {
  try {
    const res = await fetchFn(`${cfg.upstream.baseURL}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: cfg.tiers[model].model,
        instructions: CLASSIFIER_INSTRUCTIONS,
        input: [{ role: "user", content: [{ type: "input_text", text }] }],
        reasoning: { effort: "low" },
        store: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body: any = await res.json();
    const usage = parseUsage(body?.usage);
    const cost = usage ? costUSD(usage, cfg.tiers[model].price) : 0;
    if (!res.ok) return { tier: "strong", raw: `HTTP ${res.status}: ${JSON.stringify(body?.error ?? body).slice(0, 200)}`, usage, costUSD: cost };
    const answer = (body.output ?? [])
      .filter((o: any) => o?.type === "message")
      .flatMap((o: any) => o.content ?? [])
      .map((c: any) => c?.text ?? "")
      .join("")
      .trim();
    const word = answer.toLowerCase().match(/\b(weak|strong)\b/)?.[1] as TierName | undefined;
    return { tier: word ?? "strong", raw: answer, usage, costUSD: cost };
  } catch (err) {
    return { tier: "strong", raw: `error: ${err}`, usage: null, costUSD: 0 };
  }
}
