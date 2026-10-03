import { describe, expect, test } from "bun:test";
import { inspectRequest } from "../src/responses/inspect.ts";
import { ResponsesStreamReader } from "../src/sse.ts";
import { SSE_FIXTURE } from "./helpers.ts";

describe("inspectRequest", () => {
  test("counts item types and stateful features", () => {
    const shape = inspectRequest({
      model: "gpt-6.1-sol",
      stream: true,
      store: false,
      prompt_cache_key: "ses_123",
      include: ["reasoning.encrypted_content"],
      instructions: "be terse",
      tools: [{ type: "function", name: "read" }],
      input: [
        { role: "developer", content: "x" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "fix it" }] },
        { type: "reasoning", id: "rs_1", encrypted_content: "gAAA", summary: [] },
        { type: "function_call", call_id: "c1", name: "read", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "ok" },
        { type: "item_reference", id: "msg_9" },
      ],
    });
    expect(shape.itemTypes).toEqual({
      "message:developer": 1,
      "message:user": 1,
      reasoning: 1,
      function_call: 1,
      function_call_output: 1,
      item_reference: 1,
    });
    expect(shape.reasoningItemsWithEncryptedContent).toBe(1);
    expect(shape.reasoningItemsWithId).toBe(1);
    expect(shape.itemReferences).toBe(1);
    expect(shape.lastItem).toBe("item_reference");
    expect(shape.store).toBe(false);
    expect(shape.promptCacheKey).toBe("ses_123");
    expect(shape.hasPreviousResponseId).toBe(false);
    expect(shape.toolCount).toBe(1);
    expect(shape.instructionsChars).toBe(8);
  });

  test("treats string input as one user message", () => {
    const shape = inspectRequest({ model: "m", input: "hello", previous_response_id: "resp_1" });
    expect(shape.itemTypes).toEqual({ "message:user": 1 });
    expect(shape.hasPreviousResponseId).toBe(true);
  });
});

describe("ResponsesStreamReader", () => {
  test("extracts usage across arbitrary chunk boundaries", () => {
    const whole = SSE_FIXTURE.join("");
    for (const size of [1, 7, 64, whole.length]) {
      const r = new ResponsesStreamReader();
      for (let i = 0; i < whole.length; i += size) r.push(whole.slice(i, i + size));
      const s = r.end();
      expect(s.usage).toEqual({ input: 120, cachedRead: 100, cacheWrite: 0, output: 7, reasoning: 3 });
      expect(s.responseId).toBe("resp_1");
      expect(s.eventTypes["response.completed"]).toBe(1);
    }
  });

  test("records failed responses and error events", () => {
    const r = new ResponsesStreamReader();
    r.push(`data: {"type":"response.failed","response":{"id":"resp_x","error":{"code":"bad"}}}\n\n`);
    r.push(`data: {"type":"error","error":{"message":"boom"}}\n\n`);
    expect(r.end().error).toEqual({ message: "boom" });
  });
});
