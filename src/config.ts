import { homedir } from "node:os";
import { join } from "node:path";

export interface Price {
  input: number;
  output: number;
  cachedRead: number;
  cachedWrite: number;
}

export interface Tier {
  model: string;
  price: Price;
}

export type TierName = "strong" | "weak";

export interface Policy {
  /** "turn": decide per user turn. "session": decide on the first turn and hold. */
  granularity: "turn" | "session";
  strongThreshold: number;
  escalation: { consecutiveToolErrors: number; repeatedToolCalls: number };
  keywords: { strong: string[]; weak: string[] };
  /** Tier for OpenCode's title-generation requests. */
  titleTier: TierName;
  /** Tier for compaction (summary) requests; these re-read the whole context uncached. */
  compactionTier: TierName;
}

export interface Config {
  port: number;
  upstream: {
    baseURL: string;
    apiKeyEnv: string;
    /**
     * "inject": the proxy holds the credential and replaces whatever the client sends.
     * "forward": the client's Authorization header is passed through unchanged.
     */
    auth: "inject" | "forward";
  };
  tiers: { strong: Tier; weak: Tier };
  policy: Policy;
  log: { path: string; captureBodies: boolean; captureDir: string };
}

const dataDir = join(homedir(), ".local/share/agent-scaffold-router");

export const DEFAULT_CONFIG: Config = {
  port: 8787,
  upstream: {
    baseURL: "https://opencode.ai/zen/v1",
    apiKeyEnv: "OPENCODE_API_KEY",
    auth: "inject",
  },
  tiers: {
    strong: {
      model: "gpt-6.1-sol",
      price: { input: 2.0, output: 10.0, cachedRead: 0.1, cachedWrite: 2.5 },
    },
    weak: {
      model: "gpt-6-luna",
      price: { input: 0.1, output: 0.5, cachedRead: 0.01, cachedWrite: 0.125 },
    },
  },
  policy: {
    granularity: "turn",
    strongThreshold: 3,
    escalation: { consecutiveToolErrors: 3, repeatedToolCalls: 3 },
    keywords: {
      strong: ["architect", "design", "refactor", "debug", "investigate", "why", "root cause", "race", "deadlock", "performance", "security", "migrate", "plan"],
      weak: ["rename", "typo", "format", "lint", "run the tests", "commit", "list", "show me"],
    },
    titleTier: "weak",
    compactionTier: "strong",
  },
  log: {
    path: join(dataDir, "decisions.jsonl"),
    captureBodies: false,
    captureDir: join(dataDir, "captures"),
  },
};

export const CONFIG_PATH = join(homedir(), ".config/agent-scaffold-router/config.json");

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge<T>(base: T, override: DeepPartial<T> | undefined): T {
  if (override === undefined) return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const [k, v] of Object.entries(override as object)) {
    const b = (base as any)[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" ? merge(b, v) : v;
  }
  return out;
}

function expandHome(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

export async function loadConfig(path = CONFIG_PATH, overrides?: DeepPartial<Config>): Promise<Config> {
  const file = Bun.file(path);
  const fromFile = (await file.exists()) ? ((await file.json()) as DeepPartial<Config>) : undefined;
  const cfg = merge(merge(DEFAULT_CONFIG, fromFile), overrides);
  cfg.log.path = expandHome(cfg.log.path);
  cfg.log.captureDir = expandHome(cfg.log.captureDir);
  cfg.upstream.baseURL = cfg.upstream.baseURL.replace(/\/+$/, "");
  return cfg;
}
