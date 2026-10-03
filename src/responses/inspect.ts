/**
 * Summarizes the shape of a Responses API request body without its content.
 * Used by the child #1 investigation to see which stateful features a client
 * relies on (previous_response_id, stored or encrypted reasoning, item references).
 */
export interface RequestShape {
  model: string | null;
  stream: boolean;
  store: boolean | null;
  hasPreviousResponseId: boolean;
  promptCacheKey: string | null;
  include: string[];
  reasoning: unknown;
  instructionsChars: number;
  toolCount: number;
  inputItems: number;
  itemTypes: Record<string, number>;
  reasoningItemsWithEncryptedContent: number;
  reasoningItemsWithId: number;
  itemReferences: number;
  lastItem: string | null;
  topLevelKeys: string[];
}

function itemKind(item: any): string {
  if (!item || typeof item !== "object") return typeof item;
  if (item.type === "message" || (!item.type && item.role)) return `message:${item.role ?? "?"}`;
  return String(item.type ?? "unknown");
}

export function inspectRequest(body: any): RequestShape {
  const input: any[] = Array.isArray(body?.input)
    ? body.input
    : typeof body?.input === "string"
      ? [{ role: "user", content: body.input }]
      : [];
  const itemTypes: Record<string, number> = {};
  let enc = 0;
  let withId = 0;
  let refs = 0;
  for (const item of input) {
    const k = itemKind(item);
    itemTypes[k] = (itemTypes[k] ?? 0) + 1;
    if (item?.type === "reasoning") {
      if (item.encrypted_content) enc++;
      if (item.id) withId++;
    }
    if (item?.type === "item_reference") refs++;
  }
  const last = input.length ? itemKind(input[input.length - 1]) : null;
  return {
    model: typeof body?.model === "string" ? body.model : null,
    stream: body?.stream === true,
    store: typeof body?.store === "boolean" ? body.store : null,
    hasPreviousResponseId: typeof body?.previous_response_id === "string",
    promptCacheKey: typeof body?.prompt_cache_key === "string" ? body.prompt_cache_key : null,
    include: Array.isArray(body?.include) ? body.include : [],
    reasoning: body?.reasoning ?? null,
    instructionsChars: typeof body?.instructions === "string" ? body.instructions.length : 0,
    toolCount: Array.isArray(body?.tools) ? body.tools.length : 0,
    inputItems: input.length,
    itemTypes,
    reasoningItemsWithEncryptedContent: enc,
    reasoningItemsWithId: withId,
    itemReferences: refs,
    lastItem: last,
    topLevelKeys: body && typeof body === "object" ? Object.keys(body).sort() : [],
  };
}
