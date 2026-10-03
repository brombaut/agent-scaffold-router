import { createHash } from "node:crypto";
import type { Policy } from "../config.ts";

// "error"/"exception" may end a longer word so TypeError, ValueError, NullPointerException match;
// the trailing \b keeps "0 errors" from matching.
const ERROR_RE = /(error|exception)\b|\b(traceback|failed|exit code [1-9])\b/i;

function outputText(item: any): string {
  const o = item?.output;
  if (typeof o === "string") return o;
  if (Array.isArray(o)) return o.map((p) => (typeof p?.text === "string" ? p.text : "")).join("\n");
  return o == null ? "" : JSON.stringify(o);
}

/**
 * Looks for failure signals in the current turn's items. Because it scans the
 * whole turn, a signal that fired once stays fired for the rest of the turn:
 * escalation is one-way without needing any proxy-side state.
 */
export function detectEscalation(turnItems: any[], policy: Policy): string | null {
  const { consecutiveToolErrors: maxErrors, repeatedToolCalls: maxRepeats } = policy.escalation;
  let streak = 0;
  const calls = new Map<string, { name: string; n: number }>();

  for (const item of turnItems) {
    if (item?.type === "function_call_output") {
      streak = ERROR_RE.test(outputText(item)) ? streak + 1 : 0;
      if (maxErrors > 0 && streak >= maxErrors) return `escalate:tool_errors=${streak}`;
    } else if (item?.type === "function_call") {
      const name = String(item.name ?? "?");
      const key = name + ":" + createHash("sha256").update(String(item.arguments ?? "")).digest("hex");
      const entry = calls.get(key) ?? { name, n: 0 };
      entry.n++;
      calls.set(key, entry);
      if (maxRepeats > 0 && entry.n >= maxRepeats) return `escalate:repeat_call=${name} x${entry.n}`;
    }
  }
  return null;
}
