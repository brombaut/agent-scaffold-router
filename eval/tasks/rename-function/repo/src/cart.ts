export interface LineItem {
  price: number;
  qty: number;
}

/** Sum of price × quantity, in cents. */
export function calc_total(items: LineItem[]): number {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}
