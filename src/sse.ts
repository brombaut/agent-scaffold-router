export interface Usage {
  input: number;
  cachedRead: number;
  /** Tokens written to the prompt cache (a subset of input, billed at the cache-write rate). */
  cacheWrite: number;
  output: number;
  reasoning: number;
}

/** Maps an OpenAI Responses `usage` object to our shape. */
export function parseUsage(u: any): Usage | null {
  if (!u || typeof u !== "object") return null;
  return {
    input: u.input_tokens ?? 0,
    cachedRead: u.input_tokens_details?.cached_tokens ?? 0,
    cacheWrite: u.input_tokens_details?.cache_write_tokens ?? 0,
    output: u.output_tokens ?? 0,
    reasoning: u.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

export interface StreamSummary {
  usage: Usage | null;
  responseId: string | null;
  model: string | null;
  error: unknown;
  eventTypes: Record<string, number>;
  /** IDs of reasoning items the model emitted (so the router knows which model owns them). */
  reasoningIds: string[];
}

/** Collects reasoning item IDs from a Responses `output` array. */
export function reasoningIdsOf(output: unknown): string[] {
  if (!Array.isArray(output)) return [];
  return output.filter((o: any) => o?.type === "reasoning" && typeof o.id === "string").map((o: any) => o.id);
}

/**
 * Incremental SSE parser for the Responses API stream. Feed it decoded text
 * chunks; it tracks the terminal response (completed, incomplete or failed).
 */
export class ResponsesStreamReader {
  private buffer = "";
  readonly summary: StreamSummary = {
    usage: null,
    responseId: null,
    model: null,
    error: null,
    eventTypes: {},
    reasoningIds: [],
  };

  push(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.search(/\r?\n\r?\n/)) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
      this.handleEvent(raw);
    }
  }

  end(): StreamSummary {
    if (this.buffer.trim()) this.handleEvent(this.buffer);
    this.buffer = "";
    return this.summary;
  }

  private addReasoningId(id: string): void {
    if (!this.summary.reasoningIds.includes(id)) this.summary.reasoningIds.push(id);
  }

  private handleEvent(raw: string): void {
    const data = raw
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data || data === "[DONE]") return;
    let evt: any;
    try {
      evt = JSON.parse(data);
    } catch {
      return;
    }
    const type = typeof evt.type === "string" ? evt.type : "unknown";
    this.summary.eventTypes[type] = (this.summary.eventTypes[type] ?? 0) + 1;
    const resp = evt.response;
    if (resp && typeof resp === "object") {
      this.summary.responseId = resp.id ?? this.summary.responseId;
      this.summary.model = resp.model ?? this.summary.model;
      if (resp.usage) this.summary.usage = parseUsage(resp.usage);
      for (const id of reasoningIdsOf(resp.output)) this.addReasoningId(id);
      if (resp.error) this.summary.error = resp.error;
    }
    if (type === "response.output_item.done") for (const id of reasoningIdsOf([evt.item])) this.addReasoningId(id);
    if (type === "error") this.summary.error = evt.error ?? evt;
  }
}
