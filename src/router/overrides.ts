import type { TierName } from "../config.ts";
import { isUserMessage } from "../responses/items.ts";

// `opencode run` wraps the prompt in literal double quotes, so allow one before the token.
const OVERRIDE_RE = /^(\s*"?)!(strong|weak)\b[ \t]*/;

/** Returns the tier forced by a leading `!strong` / `!weak` token, if any. */
export function parseOverride(text: string): TierName | null {
  const m = OVERRIDE_RE.exec(text);
  return m ? (m[2] as TierName) : null;
}

function stripText(text: string): string {
  return text.replace(OVERRIDE_RE, "$1");
}

/**
 * Removes override tokens from every user message, in place. Stripping all of
 * them (not just the latest) keeps the forwarded prefix byte-stable across
 * requests, so prompt caching keeps working. Returns true if anything changed.
 */
export function stripOverrides(items: any[]): boolean {
  let changed = false;
  for (const item of items) {
    if (!isUserMessage(item)) continue;
    if (typeof item.content === "string") {
      const next = stripText(item.content);
      if (next !== item.content) {
        item.content = next;
        changed = true;
      }
    } else if (Array.isArray(item.content)) {
      // The token can only lead the message, so only the first text part is checked.
      const part = item.content.find((p: any) => typeof p?.text === "string");
      if (part) {
        const next = stripText(part.text);
        if (next !== part.text) {
          part.text = next;
          changed = true;
        }
      }
    }
  }
  return changed;
}
