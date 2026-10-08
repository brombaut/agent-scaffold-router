import { calc_total, type LineItem } from "./cart.ts";

export function summary(items: LineItem[]): string {
  const total = calc_total(items);
  return `${items.length} item(s), total ${(total / 100).toFixed(2)}`;
}
