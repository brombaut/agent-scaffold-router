import { deepMerge } from "./merge.ts";

export const DEFAULT_SETTINGS = {
  theme: { mode: "light", accent: "blue" },
  editor: { tabSize: 2, rulers: [80, 120] },
};

export function withDefaults(user: Record<string, any>): Record<string, any> {
  return deepMerge(structuredClone(DEFAULT_SETTINGS), user);
}
