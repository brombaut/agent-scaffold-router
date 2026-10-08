export interface LineItem {
  price: number;
  qty: number;
}

/** Sum of price × quantity, in cents. */
export function calculateTotal(items: LineItem[]): number {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}
