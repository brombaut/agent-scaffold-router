import { expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { classify } from "../src/router/classifier.ts";

const reply = (status: number, body: unknown) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
const answer = (text: string) => ({ output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 500, output_tokens: 1 } });

test("classifier parses the answer and fails open to strong", async () => {
  expect((await classify("fix the typo", "weak", DEFAULT_CONFIG, "k", reply(200, answer("weak")))).tier).toBe("weak");
  expect((await classify("x", "weak", DEFAULT_CONFIG, "k", reply(200, answer("Strong.")))).tier).toBe("strong");
  expect((await classify("x", "weak", DEFAULT_CONFIG, "k", reply(200, answer("not sure")))).tier).toBe("strong");
  expect((await classify("x", "weak", DEFAULT_CONFIG, "k", reply(500, { error: "boom" }))).tier).toBe("strong");
  const thrown = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  expect((await classify("x", "weak", DEFAULT_CONFIG, "k", thrown)).tier).toBe("strong");
});
