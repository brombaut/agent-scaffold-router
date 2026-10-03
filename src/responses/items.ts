import { createHash } from "node:crypto";

/** Leading text of OpenCode's compaction prompt (verified against OpenCode 2.0.22, report 02). */
export const COMPACTION_PREFIX = "You MUST summarize the conversation above";

export type RequestKind = "agent" | "title" | "compaction";
export type SessionKeySource = "prompt_cache_key" | "previous_response_id" | "hash";

export function isUserMessage(item: any): boolean {
  return !!item && typeof item === "object" && item.role === "user" && (item.type === undefined || item.type === "message");
}

/** Concatenated text of a message item's content (string or input_text parts). */
export function messageText(item: any): string {
  const c = item?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p?.text === "string" ? p.text : "")).join("\n");
  return "";
}

/** Normalizes `body.input` (string or item array) to an item array. */
export function inputItems(body: any): any[] {
  if (Array.isArray(body?.input)) return body.input;
  if (typeof body?.input === "string") return [{ role: "user", content: body.input }];
  return [];
}

export interface TurnInfo {
  sessionKey: string;
  sessionKeySource: SessionKeySource;
  /** 1-based count of user messages, plus any inherited from previous_response_id. */
  turnIndex: number;
  /** True when the request starts a new turn (its last input item is a user message). */
  isTurnStart: boolean;
  kind: RequestKind;
  /** Text of the latest user message (the one that started the current turn). */
  turnText: string;
  /** Text of the first user message in the session (used by granularity "session"). */
  firstText: string;
  /** Items after the latest user message: the current turn's tool-call round trips. */
  turnItems: any[];
}

export interface SessionMemory {
  /** responseId -> { sessionKey, turnIndex } for clients that chain with previous_response_id. */
  get(responseId: string): { sessionKey: string; turnIndex: number } | undefined;
}

export function analyzeTurn(body: any, memory?: SessionMemory): TurnInfo {
  const items = inputItems(body);
  let lastUser = -1;
  let firstUser = -1;
  let userCount = 0;
  items.forEach((item, i) => {
    if (isUserMessage(item)) {
      userCount++;
      lastUser = i;
      if (firstUser < 0) firstUser = i;
    }
  });

  const turnText = lastUser >= 0 ? messageText(items[lastUser]) : "";
  const firstText = firstUser >= 0 ? messageText(items[firstUser]) : "";
  const isTurnStart = items.length > 0 && lastUser === items.length - 1;

  let kind: RequestKind = "agent";
  if (turnText.trimStart().startsWith(COMPACTION_PREFIX)) kind = "compaction";
  else if (!Array.isArray(body?.tools) || body.tools.length === 0) kind = "title";

  let sessionKey: string;
  let sessionKeySource: SessionKeySource;
  let inherited = 0;
  const prev = typeof body?.previous_response_id === "string" ? memory?.get(body.previous_response_id) : undefined;
  if (typeof body?.prompt_cache_key === "string" && body.prompt_cache_key) {
    sessionKey = body.prompt_cache_key;
    sessionKeySource = "prompt_cache_key";
  } else if (prev) {
    sessionKey = prev.sessionKey;
    sessionKeySource = "previous_response_id";
  } else {
    const instr = typeof body?.instructions === "string" ? body.instructions : "";
    sessionKey = createHash("sha256").update(instr + "\u0000" + firstText).digest("hex").slice(0, 16);
    sessionKeySource = "hash";
  }
  if (prev) inherited = prev.turnIndex;

  return {
    sessionKey,
    sessionKeySource,
    turnIndex: inherited + userCount,
    isTurnStart,
    kind,
    turnText,
    firstText,
    turnItems: lastUser >= 0 ? items.slice(lastUser + 1) : items,
  };
}
