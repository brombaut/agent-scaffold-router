/** Which upstream model produced a reasoning item, keyed by its `rs_` ID. */
export interface ReasoningOwners {
  get(id: string): string | undefined;
}

/**
 * Makes conversation history portable between models.
 *
 * With one virtual model name, OpenCode keeps earlier reasoning items in the
 * history. When OpenCode's session headers are present, Zen rejects a
 * gpt-6.1-sol request that carries gpt-6-luna's encrypted reasoning (HTTP 400,
 * body `{"model":"gpt-6.1-sol"}`; report 03). Removing those items fixes it,
 * between turns and mid-turn, and the paired function calls can stay.
 *
 * Reasoning items produced by `targetModel` are kept, so a model keeps its own
 * reasoning and its cached prefix. Items with an unknown owner (e.g. after a
 * proxy restart) are dropped: losing some reasoning beats a rejected request.
 * Returns the number of items removed. Mutates `items`.
 */
export function dropForeignReasoning(items: any[], targetModel: string, owners: ReasoningOwners): number {
  let removed = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.type !== "reasoning") continue;
    const owner = typeof item.id === "string" ? owners.get(item.id) : undefined;
    if (owner === targetModel) continue;
    items.splice(i, 1);
    removed++;
  }
  return removed;
}
