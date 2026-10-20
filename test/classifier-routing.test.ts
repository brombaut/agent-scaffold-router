import { afterEach, expect, test } from "bun:test";
import type { Config } from "../src/config.ts";
import type { classify } from "../src/router/classifier.ts";
import { mockUpstream, SSE_FIXTURE, sseResponse, startProxy, testConfig } from "./helpers.ts";

const stops: (() => void)[] = [];
afterEach(() => {
  while (stops.length) stops.pop()!();
});

const TOOLS = [{ type: "function", name: "read" }];
const user = (text: string) => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });
const reply = (text: string) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
const call = (id: string) => ({ type: "function_call", call_id: id, name: "read", arguments: "{}" });
const out = (id: string) => ({ type: "function_call_output", call_id: id, output: "ok" });

function setup(mode: Config["policy"]["classifier"]["mode"], answer: "weak" | "strong") {
  const up = mockUpstream(() => sseResponse(SSE_FIXTURE));
  const cfg = testConfig(up.baseURL);
  cfg.policy = { ...cfg.policy, classifier: { ...cfg.policy.classifier, mode } };
  const asked: string[] = [];
  const stub = (async (text: string) => {
    asked.push(text);
    return { tier: answer, raw: answer, usage: null, costUSD: 0.002 };
  }) as typeof classify;
  const proxy = startProxy(cfg, "test-key", { classify: stub });
  stops.push(() => up.server.stop(true), () => proxy.server.stop(true));
  const send = async (input: object[]) => {
    const res = await fetch(`${proxy.url}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", stream: true, tools: TOOLS, prompt_cache_key: "ses_c", input }),
    });
    await res.text();
    return proxy.nextLog();
  };
  return { send, asked };
}

test("on: one classifier call per turn routes every request in it, and the next turn hears who handled the last", async () => {
  const { send, asked } = setup("on", "strong");
  const t1 = [user("show me the readme")];
  const a = await send(t1);
  const b = await send([...t1, call("1"), out("1")]);
  expect([a.tier, b.tier]).toEqual(["strong", "strong"]);
  expect(a).toMatchObject({ reason: "classifier:strong", arm: "on", classifierTier: "strong", heuristicTier: "weak", classifierCostUSD: 0.002 });
  expect(b.classifierCostUSD).toBeUndefined(); // counted once per turn
  expect(asked).toEqual(["show me the readme"]);

  await send([...t1, call("1"), out("1"), reply("done"), user("that's still wrong")]);
  expect(asked).toHaveLength(2);
  expect(asked[1]).toContain("previous turn was handled by the large model");
});

test("shadow: logs the classifier's pick but routes by the heuristic", async () => {
  const { send } = setup("shadow", "strong");
  const l = await send([user("show me the readme")]);
  expect(l).toMatchObject({ tier: "weak", arm: "shadow", classifierTier: "strong", heuristicTier: "weak" });
  expect(l.reason).toStartWith("heuristic:");
});

test("off: no classifier fields, and !strong skips the classifier", async () => {
  const off = setup("off", "strong");
  expect((await off.send([user("show me the readme")])).arm).toBeUndefined();
  const on = setup("on", "weak");
  expect((await on.send([user("!strong show me the readme")])).reason).toBe("override:!strong");
  expect(on.asked).toHaveLength(0);
});
