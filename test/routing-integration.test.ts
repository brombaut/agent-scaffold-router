import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mockUpstream, SSE_FIXTURE, sseResponse, startProxy, testConfig } from "./helpers.ts";

const stops: (() => void)[] = [];
afterEach(() => {
  while (stops.length) stops.pop()!();
});

const TOOLS = [{ type: "function", name: "read" }];
const user = (text: string) => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });
const call = (name: string, id: string) => ({ type: "function_call", call_id: id, name, arguments: `{"id":"${id}"}` });
const out = (output: string, id: string) => ({ type: "function_call_output", call_id: id, output });

function setup(opts: Parameters<typeof startProxy>[2] = {}) {
  const up = mockUpstream(() => sseResponse(SSE_FIXTURE));
  const cfg = testConfig(up.baseURL);
  cfg.log.captureBodies = true;
  const proxy = startProxy(cfg, "test-key", opts);
  stops.push(() => up.server.stop(true), () => proxy.server.stop(true));
  return { up, cfg, proxy };
}

async function send(url: string, body: object) {
  const res = await fetch(`${url}/v1/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await res.text();
  return res;
}

describe("routing through the proxy", () => {
  test("acceptance 4: every request in a turn shares a tier unless it escalates, and never de-escalates", async () => {
    const { up, proxy } = setup();
    const base = { model: "auto", stream: true, tools: TOOLS, prompt_cache_key: "ses_t" };
    const turn = [user("show me the readme")];
    const steps = [
      turn,
      [...turn, call("read", "1"), out("Error: nope", "1")],
      [...turn, call("read", "1"), out("Error: nope", "1"), call("read", "2"), out("Error: nope", "2")],
      [...turn, call("read", "1"), out("Error: nope", "1"), call("read", "2"), out("Error: nope", "2"), call("read", "3"), out("failed", "3")],
      [...turn, call("read", "1"), out("Error: nope", "1"), call("read", "2"), out("Error: nope", "2"), call("read", "3"), out("failed", "3"), call("read", "4"), out("ok", "4")],
    ];
    const tiers: string[] = [];
    const reasons: string[] = [];
    for (const input of steps) {
      await send(proxy.url, { ...base, input });
      const l = await proxy.nextLog();
      tiers.push(l.tier!);
      reasons.push(l.reason!);
      expect(l.sessionKey).toBe("ses_t");
      expect(l.turnIndex).toBe(1);
    }
    expect(tiers).toEqual(["weak", "weak", "weak", "strong", "strong"]);
    expect(reasons.slice(3)).toEqual(["escalate:tool_errors=3", "escalate:tool_errors=3"]);
    expect(up.seen.map((r) => JSON.parse(r.body).model)).toEqual(["gpt-6-luna", "gpt-6-luna", "gpt-6-luna", "gpt-6.1-sol", "gpt-6.1-sol"]);
  });

  test("acceptance 5: !strong forces the turn and never reaches the upstream", async () => {
    const { up, cfg, proxy } = setup();
    const base = { model: "auto", stream: true, tools: TOOLS, prompt_cache_key: "ses_o" };
    const turn = [user("!strong show me the readme")];
    for (const input of [turn, [...turn, call("read", "1"), out("ok", "1")], [...turn, call("read", "1"), out("ok", "1"), { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] }, user("thanks")]]) {
      await send(proxy.url, { ...base, input });
    }
    const lines = [await proxy.nextLog(), await proxy.nextLog(), await proxy.nextLog()];
    expect(lines.slice(0, 2).map((l) => l.reason)).toEqual(["override:!strong", "override:!strong"]);
    expect(lines[2]!.reason).not.toContain("override");
    for (const r of up.seen) expect(r.body).not.toContain("!strong");
    for (const l of lines) expect(readFileSync(`${cfg.log.captureDir}/${l.requestId}.request.json`, "utf8")).not.toContain("!strong");
  });

  test("forwarded prefix stays byte-stable across requests after stripping", async () => {
    const { up, proxy } = setup();
    const base = { model: "auto", stream: true, tools: TOOLS, prompt_cache_key: "ses_p" };
    const t1 = [user("!strong first")];
    await send(proxy.url, { ...base, input: t1 });
    await send(proxy.url, { ...base, input: [...t1, call("read", "1"), out("ok", "1")] });
    const [a, b] = up.seen.map((r) => JSON.stringify(JSON.parse(r.body).input[0]));
    expect(a).toBe(b!);
  });

  test("acceptance 6: a classifier exception routes to strong and the request still succeeds", async () => {
    const { up, proxy } = setup({
      score: () => {
        throw new Error("injected");
      },
    });
    const res = await send(proxy.url, { model: "auto", stream: true, tools: TOOLS, input: [user("hello")] });
    expect(res.status).toBe(200);
    const l = await proxy.nextLog();
    expect(l).toMatchObject({ tier: "strong", reason: "router_error", upstreamModel: "gpt-6.1-sol" });
    expect(JSON.parse(up.seen[0]!.body).model).toBe("gpt-6.1-sol");
  });

  test("unknown models get a 400 and nothing is forwarded", async () => {
    const { up, proxy } = setup();
    const res = await fetch(`${proxy.url}/v1/responses`, { method: "POST", body: JSON.stringify({ model: "gpt-6-luna", input: "hi" }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.message).toContain("auto, strong, weak");
    expect(up.seen).toHaveLength(0);
  });

  test("cost and the all-strong counterfactual are logged", async () => {
    const { proxy } = setup();
    await send(proxy.url, { model: "weak", stream: true, tools: TOOLS, input: [user("hi")] });
    const l = await proxy.nextLog();
    // fixture usage: 120 input (100 cached), 7 output, priced at Luna then Sol rates
    expect(l.costUSD).toBeCloseTo((20 * 0.1 + 100 * 0.01 + 7 * 0.5) / 1e6, 12);
    expect(l.allStrongCostUSD).toBeCloseTo((20 * 2 + 100 * 0.1 + 7 * 10) / 1e6, 12);
  });
});

describe("reasoning ownership across models", () => {
  test("a weak turn's reasoning is kept for weak and dropped when the next turn goes strong", async () => {
    let n = 0;
    const up = mockUpstream(() => {
      n++;
      const model = n === 1 ? "gpt-6-luna" : "gpt-6.1-sol";
      return sseResponse([
        `data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"rs_${n}","encrypted_content":"e"}}\n\n`,
        `data: {"type":"response.completed","response":{"id":"resp_${n}","model":"${model}","usage":{"input_tokens":10,"output_tokens":1}}}\n\n`,
      ]);
    });
    const cfg = testConfig(up.baseURL);
    const proxy = startProxy(cfg);
    stops.push(() => up.server.stop(true), () => proxy.server.stop(true));
    const base = { model: "auto", stream: true, tools: TOOLS, prompt_cache_key: "ses_r" };
    const rs1 = { type: "reasoning", id: "rs_1", encrypted_content: "e", summary: [] };

    await send(proxy.url, { ...base, input: [user("show me the readme")] });
    expect((await proxy.nextLog()).tier).toBe("weak");

    // same weak turn continues: Luna's own reasoning stays
    await send(proxy.url, { ...base, input: [user("show me the readme"), rs1, call("read", "1"), out("ok", "1")] });
    const l2 = await proxy.nextLog();
    expect(l2).toMatchObject({ tier: "weak", droppedReasoning: 0 });
    expect(JSON.parse(up.seen[1]!.body).input).toContainEqual(rs1);

    // next turn routes strong: Luna's reasoning is removed before it reaches Sol
    await send(proxy.url, { ...base, input: [user("show me the readme"), rs1, call("read", "1"), out("ok", "1"), user("debug why the race happens")] });
    const l3 = await proxy.nextLog();
    expect(l3).toMatchObject({ tier: "strong", droppedReasoning: 1 });
    const forwarded = JSON.parse(up.seen[2]!.body).input;
    expect(forwarded.some((i: any) => i.type === "reasoning")).toBe(false);
    expect(forwarded.some((i: any) => i.type === "function_call")).toBe(true);
  });
});
