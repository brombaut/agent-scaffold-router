import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { mockUpstream, SSE_FIXTURE, sseResponse, startProxy, testConfig } from "./helpers.ts";

const stops: (() => void)[] = [];
afterEach(() => {
  while (stops.length) stops.pop()!();
});

function setup(reply: Parameters<typeof mockUpstream>[0], opts: { key?: string | null; capture?: boolean; auth?: "inject" | "forward" } = {}) {
  const up = mockUpstream(reply);
  const cfg = testConfig(up.baseURL);
  if (opts.capture) cfg.log.captureBodies = true;
  if (opts.auth) cfg.upstream.auth = opts.auth;
  const proxy = startProxy(cfg, opts.key === undefined ? "test-key" : opts.key);
  stops.push(() => up.server.stop(true), () => proxy.server.stop(true));
  return { up, cfg, proxy };
}

const body = JSON.stringify({ model: "gpt-6-luna", stream: true, input: [{ role: "user", content: "say hi" }] });

describe("passthrough", () => {
  test("streams the upstream SSE byte-for-byte and forwards the body unchanged", async () => {
    const { up, proxy } = setup(() => sseResponse(SSE_FIXTURE));
    const res = await fetch(`${proxy.url}/v1/responses`, { method: "POST", headers: { "content-type": "application/json" }, body });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toBe(SSE_FIXTURE.join(""));
    expect(up.seen).toHaveLength(1);
    expect(up.seen[0]!.path).toBe("/zen/v1/responses");
    expect(up.seen[0]!.body).toBe(body);
  });

  test("logs usage, response id and request shape after the stream ends", async () => {
    const { proxy } = setup(() => sseResponse(SSE_FIXTURE));
    await (await fetch(`${proxy.url}/v1/responses`, { method: "POST", body })).text();
    const line = await proxy.nextLog();
    expect(line.status).toBe(200);
    expect(line.requestedModel).toBe("gpt-6-luna");
    expect(line.upstreamModel).toBe("gpt-6-luna");
    expect(line.responseId).toBe("resp_1");
    expect(line.usage).toEqual({ input: 120, cachedRead: 100, cacheWrite: 0, output: 7, reasoning: 3 });
    expect(line.shape?.lastItem).toBe("message:user");
    expect(line.ttftMs).not.toBeNull();
  });

  test("handles non-streaming JSON responses", async () => {
    const json = { id: "resp_2", model: "gpt-6.1-sol", usage: { input_tokens: 5, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 4 }, output_tokens: 2 } };
    const { proxy } = setup(() => Response.json(json));
    const res = await fetch(`${proxy.url}/v1/responses`, { method: "POST", body: JSON.stringify({ model: "gpt-6.1-sol", input: "hi" }) });
    expect(await res.json()).toEqual(json);
    const line = await proxy.nextLog();
    expect(line.usage).toEqual({ input: 5, cachedRead: 0, cacheWrite: 4, output: 2, reasoning: 0 });
    expect(line.responseId).toBe("resp_2");
  });
});

describe("auth", () => {
  test("inject mode replaces the client's Authorization with the resolved key", async () => {
    const { up, proxy } = setup(() => sseResponse(SSE_FIXTURE));
    await (await fetch(`${proxy.url}/v1/responses`, { method: "POST", headers: { authorization: "Bearer placeholder" }, body })).text();
    expect(up.seen[0]!.headers.get("authorization")).toBe("Bearer test-key");
  });

  test("forward mode passes the client's Authorization through", async () => {
    const { up, proxy } = setup(() => sseResponse(SSE_FIXTURE), { auth: "forward" });
    await (await fetch(`${proxy.url}/v1/responses`, { method: "POST", headers: { authorization: "Bearer client" }, body })).text();
    expect(up.seen[0]!.headers.get("authorization")).toBe("Bearer client");
  });
});

describe("errors", () => {
  test("upstream 4xx status and body reach the client unchanged", async () => {
    const err = { error: { message: "model not found", type: "invalid_request_error" } };
    const { proxy } = setup(() => Response.json(err, { status: 404 }));
    const res = await fetch(`${proxy.url}/v1/responses`, { method: "POST", body });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(err);
    const line = await proxy.nextLog();
    expect(line.status).toBe(404);
    expect(line.error).toContain("model not found");
  });

  test("unreachable upstream returns 502 and is logged", async () => {
    const cfg = testConfig("http://127.0.0.1:1/zen/v1");
    const proxy = startProxy(cfg);
    stops.push(() => proxy.server.stop(true));
    const res = await fetch(`${proxy.url}/v1/responses`, { method: "POST", body });
    expect(res.status).toBe(502);
    const line = await proxy.nextLog();
    expect(line.error).toContain("upstream_unreachable");
  });
});

describe("routes", () => {
  test("healthz, models and 404", async () => {
    const { proxy } = setup(() => new Response("unused"));
    expect(await (await fetch(`${proxy.url}/healthz`)).json()).toEqual({ ok: true });
    const models = (await (await fetch(`${proxy.url}/v1/models`)).json()) as any;
    expect(models.data.map((m: any) => m.id)).toEqual(["gpt-6.1-sol", "gpt-6-luna"]);
    const res = await fetch(`${proxy.url}/v1/chat/completions`, { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
  });
});

describe("capture", () => {
  test("writes request body and raw response, never the Authorization header", async () => {
    const { cfg, proxy } = setup(() => sseResponse(SSE_FIXTURE), { capture: true });
    await (await fetch(`${proxy.url}/v1/responses`, { method: "POST", headers: { authorization: "Bearer secret-xyz" }, body })).text();
    const line = await proxy.nextLog();
    const files = readdirSync(cfg.log.captureDir).sort();
    expect(files).toEqual([`${line.requestId}.request.json`, `${line.requestId}.response.200.txt`]);
    const all = files.map((f) => readFileSync(`${cfg.log.captureDir}/${f}`, "utf8")).join("");
    expect(all).not.toContain("secret-xyz");
    expect(all).not.toContain("test-key");
  });
});
