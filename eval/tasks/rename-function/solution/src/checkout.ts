import { calculateTotal, type LineItem } from "./cart.ts";

export function summary(items: LineItem[]): string {
  const total = calculateTotal(items);
  return `${items.length} item(s), total ${(total / 100).toFixed(2)}`;
}
