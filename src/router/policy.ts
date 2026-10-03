import type { Config, TierName } from "../config.ts";
import { analyzeTurn, inputItems, type SessionMemory, type TurnInfo } from "../responses/items.ts";
import { dropForeignReasoning, type ReasoningOwners } from "../responses/sanitize.ts";
import { detectEscalation } from "./escalation.ts";
import { scoreMessage } from "./heuristics.ts";
import { parseOverride, stripOverrides } from "./overrides.ts";

export const VIRTUAL_MODELS = ["auto", "strong", "weak"] as const;
export type VirtualModel = (typeof VIRTUAL_MODELS)[number];

export class UnknownModelError extends Error {
  constructor(model: unknown) {
    super(`unknown model ${JSON.stringify(model)}; agent-scaffold-router serves: ${VIRTUAL_MODELS.join(", ")}`);
  }
}

export interface Decision {
  requestedModel: VirtualModel;
  tier: TierName;
  upstreamModel: string;
  reason: string;
  turn: TurnInfo | null;
  /** Reasoning items removed because another model produced them. */
  droppedReasoning: number;
}

export interface RouteDeps {
  memory?: SessionMemory;
  /** Which model produced each reasoning item seen in a response. */
  reasoningOwners?: ReasoningOwners;
  /** Swappable for tests (e.g. to inject a classifier failure). */
  score?: typeof scoreMessage;
}

/**
 * Decides the tier for one request and rewrites `body` in place: sets the
 * upstream model and strips override tokens. Any routing failure fails open to
 * the strong tier; only an unknown requested model is rejected.
 */
export function route(body: any, cfg: Config, deps: RouteDeps = {}): Decision {
  const requested = body?.model;
  if (!VIRTUAL_MODELS.includes(requested)) throw new UnknownModelError(requested);
  const requestedModel = requested as VirtualModel;

  let tier: TierName;
  let reason: string;
  let turn: TurnInfo | null = null;
  try {
    ({ tier, reason, turn } = decide(body, requestedModel, cfg, deps));
  } catch (err) {
    tier = "strong";
    reason = "router_error";
    console.error("[agent-scaffold-router] routing failed, using strong:", err);
  }
  const upstreamModel = cfg.tiers[tier].model;
  body.model = upstreamModel;
  let droppedReasoning = 0;
  try {
    droppedReasoning = dropForeignReasoning(inputItems(body), upstreamModel, deps.reasoningOwners ?? new Map());
  } catch (err) {
    console.error("[agent-scaffold-router] history sanitizing failed:", err);
  }
  return { requestedModel, tier, upstreamModel, reason, turn, droppedReasoning };
}

function decide(body: any, requested: VirtualModel, cfg: Config, deps: RouteDeps) {
  const { policy } = cfg;
  const turn = analyzeTurn(body, deps.memory);
  const override = parseOverride(turn.turnText);
  stripOverrides(inputItems(body));

  if (requested !== "auto") return { tier: requested as TierName, reason: "forced", turn };
  if (turn.kind === "title") return { tier: policy.titleTier, reason: "title", turn };
  if (turn.kind === "compaction") return { tier: policy.compactionTier, reason: "compaction", turn };
  if (override) return { tier: override, reason: `override:!${override}`, turn };

  const score = deps.score ?? scoreMessage;
  const base =
    policy.granularity === "session"
      ? (({ tier, reason }) => ({ tier, reason: `session:${reason}` }))(score(turn.firstText, policy))
      : score(turn.turnText, policy);
  if (base.tier === "weak") {
    const escalated = detectEscalation(turn.turnItems, policy);
    if (escalated) return { tier: "strong" as TierName, reason: escalated, turn };
  }
  return { tier: base.tier, reason: base.reason, turn };
}
