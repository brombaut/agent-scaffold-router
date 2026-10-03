import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type Config } from "../src/config.ts";
import { analyzeTurn, COMPACTION_PREFIX } from "../src/responses/items.ts";
import { detectEscalation } from "../src/router/escalation.ts";
import { scoreMessage } from "../src/router/heuristics.ts";
import { parseOverride, stripOverrides } from "../src/router/overrides.ts";
import { route, UnknownModelError } from "../src/router/policy.ts";

const policy = DEFAULT_CONFIG.policy;
const user = (text: string) => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });
const call = (name: string, args = "{}", id = Math.random().toString(36)) => ({ type: "function_call", call_id: id, name, arguments: args });
const out = (output: string) => ({ type: "function_call_output", call_id: "x", output });
const TOOLS = [{ type: "function", name: "read" }];
const req = (model: string, input: any[], extra: object = {}) => ({ model, tools: TOOLS, input, ...extra });

describe("analyzeTurn", () => {
  test("turn start vs continuation, turn index, items after the user message", () => {
    const start = analyzeTurn(req("auto", [user("a"), call("read"), out("ok"), user("b")]));
    expect(start.isTurnStart).toBe(true);
    expect(start.turnIndex).toBe(2);
    expect(start.turnText).toBe("b");
    expect(start.firstText).toBe("a");
    expect(start.turnItems).toEqual([]);

    const cont = analyzeTurn(req("auto", [user("a"), call("read"), out("ok")]));
    expect(cont.isTurnStart).toBe(false);
    expect(cont.turnIndex).toBe(1);
    expect(cont.turnItems).toHaveLength(2);
  });

  test("bare role:user items and string input count as user messages", () => {
    expect(analyzeTurn(req("auto", [{ role: "user", content: "hi" }])).isTurnStart).toBe(true);
    const s = analyzeTurn({ model: "auto", tools: TOOLS, input: "hello" });
    expect(s.turnText).toBe("hello");
    expect(s.turnIndex).toBe(1);
  });

  test("session key: prompt_cache_key, then previous_response_id, then a stable hash", () => {
    expect(analyzeTurn(req("auto", [user("a")], { prompt_cache_key: "ses_1" }))).toMatchObject({ sessionKey: "ses_1", sessionKeySource: "prompt_cache_key" });

    const memory = new Map([["resp_9", { sessionKey: "ses_old", turnIndex: 4 }]]);
    const chained = analyzeTurn(req("auto", [user("next")], { previous_response_id: "resp_9" }), memory);
    expect(chained).toMatchObject({ sessionKey: "ses_old", sessionKeySource: "previous_response_id", turnIndex: 5 });

    const h1 = analyzeTurn(req("auto", [user("a")], { instructions: "x" }));
    const h2 = analyzeTurn(req("auto", [user("a"), call("read"), out("ok"), user("b")], { instructions: "x" }));
    expect(h1.sessionKeySource).toBe("hash");
    expect(h1.sessionKey).toHaveLength(16);
    expect(h2.sessionKey).toBe(h1.sessionKey);
  });

  test("detects title (no tools) and compaction (summary prompt) requests", () => {
    expect(analyzeTurn({ model: "auto", input: [user("hi")] }).kind).toBe("title");
    expect(analyzeTurn(req("auto", [user("hi"), user(`${COMPACTION_PREFIX} into a structured summary`)])).kind).toBe("compaction");
    expect(analyzeTurn(req("auto", [user("hi")])).kind).toBe("agent");
  });
});

describe("scoreMessage", () => {
  test("plain short message is weak with score 0", () => {
    expect(scoreMessage("add a newline at the end of foo.ts", policy)).toMatchObject({ tier: "weak", score: 0 });
  });

  test("two strong keywords reach the threshold", () => {
    const r = scoreMessage("debug why the cache misses", policy);
    expect(r.tier).toBe("strong");
    expect(r.score).toBe(4);
    expect(r.reason).toBe("heuristic:score=4[keyword:debug,keyword:why]");
  });

  test("strong keywords cap at +4", () => {
    expect(scoreMessage("design a plan to refactor and debug the race", policy).score).toBe(4);
  });

  test("one strong keyword alone stays weak at the default threshold", () => {
    expect(scoreMessage("refactor this function", policy)).toMatchObject({ tier: "weak", score: 2 });
  });

  test("keywords match whole words only", () => {
    expect(scoreMessage("the designer planned it", policy).score).toBe(0);
  });

  test("length, file paths and big code blocks add points", () => {
    const long = "x".repeat(2001);
    expect(scoreMessage(long, policy).signals).toContain("len>2000");
    expect(scoreMessage("touch a.ts b.ts c/d.json", policy).signals).toContain("files=3");
    const code = "```ts\n" + "line\n".repeat(51) + "```";
    expect(scoreMessage(code, policy).signals).toContain("code>50");
  });

  test("weak keywords subtract, capped at -2", () => {
    const r = scoreMessage("rename it, fix the typo, format, lint and commit", policy);
    expect(r.score).toBe(-2);
    expect(r.signals).toEqual(["weak:rename", "weak:typo"]);
  });

  test("threshold boundary", () => {
    const cfgPolicy = { ...policy, strongThreshold: 2 };
    expect(scoreMessage("refactor this", cfgPolicy).tier).toBe("strong");
  });
});

describe("overrides", () => {
  test("parse only a leading token", () => {
    expect(parseOverride("!strong fix it")).toBe("strong");
    expect(parseOverride("  !weak")).toBe("weak");
    expect(parseOverride("fix it !strong")).toBeNull();
    expect(parseOverride("!stronger")).toBeNull();
    // `opencode run` sends the prompt wrapped in literal quotes
    expect(parseOverride('"!weak Read math.ts"')).toBe("weak");
  });

  test("strip from every user message, string and part content, leaving others alone", () => {
    const items: any[] = [
      { role: "user", content: "!strong first" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "!strong not a user" }] },
      user("!weak second"),
      user("no token"),
      user('"!strong quoted"'),
    ];
    expect(stripOverrides(items)).toBe(true);
    expect(items[0].content).toBe("first");
    expect(items[1].content[0].text).toBe("!strong not a user");
    expect(items[2].content[0].text).toBe("second");
    expect(items[4].content[0].text).toBe('"quoted"');
    expect(stripOverrides(items)).toBe(false);
  });
});

describe("detectEscalation", () => {
  test("three consecutive tool errors escalate; a success resets the streak", () => {
    expect(detectEscalation([out("Error: x"), out("ok"), out("failed"), out("Traceback")], policy)).toBeNull();
    expect(detectEscalation([out("Error: x"), out("exit code 2"), out("TypeError: y")], policy)).toBe("escalate:tool_errors=3");
  });

  test("repeated identical calls escalate; different args do not", () => {
    expect(detectEscalation([call("read", '{"p":1}'), call("read", '{"p":2}'), call("read", '{"p":3}')], policy)).toBeNull();
    expect(detectEscalation([call("read", '{"p":1}'), out("ok"), call("read", '{"p":1}'), out("ok"), call("read", '{"p":1}')], policy)).toBe(
      "escalate:repeat_call=read x3",
    );
  });

  test("one-way: a later success does not undo an escalation that already fired", () => {
    const items = [out("error"), out("error"), out("error"), out("all good now")];
    expect(detectEscalation(items, policy)).toBe("escalate:tool_errors=3");
  });

  test("exit code 0 and '0 errors' are not errors", () => {
    expect(detectEscalation([out("exit code 0"), out("exit code 0"), out("exit code 0")], policy)).toBeNull();
    expect(detectEscalation([out("lint: 0 errors"), out("lint: 0 errors"), out("lint: 0 errors")], policy)).toBeNull();
  });
});

describe("route", () => {
  const cfg: Config = DEFAULT_CONFIG;

  test("rejects unknown models", () => {
    expect(() => route(req("gpt-6-luna", [user("hi")]), cfg)).toThrow(UnknownModelError);
  });

  test("forced tiers ignore heuristics but still strip overrides", () => {
    const body = req("weak", [user("!strong debug why it races")]);
    const d = route(body, cfg);
    expect(d).toMatchObject({ tier: "weak", reason: "forced", upstreamModel: "gpt-6-luna" });
    expect(body.model).toBe("gpt-6-luna");
    expect((body.input[0] as any).content[0].text).toBe("debug why it races");
  });

  test("auto: cheap first, strong on heuristic, override wins", () => {
    expect(route(req("auto", [user("show me the readme")]), cfg)).toMatchObject({ tier: "weak" });
    expect(route(req("auto", [user("debug why the race happens")]), cfg)).toMatchObject({ tier: "strong" });
    expect(route(req("auto", [user("!strong show me the readme")]), cfg)).toMatchObject({ tier: "strong", reason: "override:!strong" });
    expect(route(req("auto", [user("!weak debug why the race happens")]), cfg)).toMatchObject({ tier: "weak", reason: "override:!weak" });
  });

  test("continuations keep the turn's tier unless escalation fires", () => {
    const turn = [user("show me the readme"), call("read"), out("ok")];
    expect(route(req("auto", turn), cfg)).toMatchObject({ tier: "weak" });
    const failing = [user("show me the readme"), call("a"), out("error"), call("b"), out("error"), call("c"), out("error")];
    expect(route(req("auto", failing), cfg)).toMatchObject({ tier: "strong", reason: "escalate:tool_errors=3" });
  });

  test("an override suppresses escalation for the turn", () => {
    const failing = [user("!weak go"), call("a"), out("error"), call("b"), out("error"), call("c"), out("error")];
    expect(route(req("auto", failing), cfg)).toMatchObject({ tier: "weak", reason: "override:!weak" });
  });

  test("title and compaction use their configured tiers", () => {
    expect(route({ model: "auto", input: [user("debug why")] }, cfg)).toMatchObject({ tier: "weak", reason: "title" });
    expect(route(req("auto", [user("x"), user(COMPACTION_PREFIX + " now")]), cfg)).toMatchObject({ tier: "strong", reason: "compaction" });
  });

  test("session granularity decides from the first user message", () => {
    const sessionCfg = { ...cfg, policy: { ...cfg.policy, granularity: "session" as const } };
    const d = route(req("auto", [user("debug why the race happens"), user("show me the readme")]), sessionCfg);
    expect(d.tier).toBe("strong");
    expect(d.reason.startsWith("session:heuristic")).toBe(true);
  });

  test("drops reasoning items another model produced, keeps its own and the function calls", () => {
    const lunaRs = { type: "reasoning", id: "rs_luna", encrypted_content: "gAAA", summary: [] };
    const solRs = { type: "reasoning", id: "rs_sol", encrypted_content: "gBBB", summary: [] };
    const unknownRs = { type: "reasoning", id: "rs_unknown", encrypted_content: "gCCC", summary: [] };
    const fc = { type: "function_call", id: "fc_1", call_id: "c1", name: "read", arguments: "{}" };
    const owners = new Map([
      ["rs_luna", "gpt-6-luna"],
      ["rs_sol", "gpt-6.1-sol"],
    ]);
    const history = () => [user("show me"), lunaRs, fc, { type: "function_call_output", call_id: "c1", output: "ok" }, solRs, unknownRs, user("next")];

    const toStrong = req("strong", history());
    expect(route(toStrong, cfg, { reasoningOwners: owners }).droppedReasoning).toBe(2);
    expect(toStrong.input.filter((i: any) => i.type === "reasoning")).toEqual([solRs]);
    expect(toStrong.input).toContainEqual(fc);

    const toWeak = req("weak", history());
    expect(route(toWeak, cfg, { reasoningOwners: owners }).droppedReasoning).toBe(2);
    expect(toWeak.input.filter((i: any) => i.type === "reasoning")).toEqual([lunaRs]);
  });

  test("a classifier exception fails open to strong", () => {
    const body = req("auto", [user("show me the readme")]);
    const d = route(body, cfg, {
      score: () => {
        throw new Error("boom");
      },
    });
    expect(d).toMatchObject({ tier: "strong", reason: "router_error", upstreamModel: "gpt-6.1-sol" });
    expect(body.model).toBe("gpt-6.1-sol");
  });
});
