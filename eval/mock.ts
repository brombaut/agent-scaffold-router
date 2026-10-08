/**
 * A stand-in for Zen's /responses endpoint for `run --mock`: every request gets
 * a short text reply and no tool calls, so the agent gives up straight away.
 * It exercises the whole pipeline (OpenCode, proxy, logging, checks, summary)
 * without spending anything; every task is expected to fail.
 */
export function startMockUpstream() {
  let n = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "POST" || !url.pathname.endsWith("/responses")) {
        return Response.json({ error: { message: "mock upstream: not found" } }, { status: 404 });
      }
      const body = (await req.json()) as { model?: string };
      const id = `resp_mock_${++n}`;
      const msgId = `msg_mock_${n}`;
      const model = body.model ?? "mock";
      const text = "Mock upstream: no changes made.";
      const message = {
        id: msgId,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      };
      const usage = {
        input_tokens: 1000,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 10,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 1010,
      };
      const events: [string, object][] = [
        ["response.created", { response: { id, object: "response", model, status: "in_progress", output: [] } }],
        ["response.output_item.added", { output_index: 0, item: { ...message, status: "in_progress", content: [] } }],
        ["response.content_part.added", { item_id: msgId, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } }],
        ["response.output_text.delta", { item_id: msgId, output_index: 0, content_index: 0, delta: text }],
        ["response.output_text.done", { item_id: msgId, output_index: 0, content_index: 0, text }],
        ["response.content_part.done", { item_id: msgId, output_index: 0, content_index: 0, part: message.content[0] }],
        ["response.output_item.done", { output_index: 0, item: message }],
        ["response.completed", { response: { id, object: "response", model, status: "completed", output: [message], usage } }],
      ];
      const sse = events
        .map(([type, data], i) => `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: i, ...data })}\n\n`)
        .join("");
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    },
  });
  return { server, baseURL: `http://127.0.0.1:${server.port}/zen/v1` };
}
