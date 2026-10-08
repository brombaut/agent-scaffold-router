import { expect, test } from "bun:test";
import * as cart from "../src/cart.ts";
import { summary } from "../src/checkout.ts";

test("calculateTotal", () => {
  expect(cart.calculateTotal([{ price: 250, qty: 2 }, { price: 100, qty: 1 }])).toBe(600);
});

test("old name is gone", () => {
  expect("calc_total" in cart).toBe(false);
});

test("summary", () => {
  expect(summary([{ price: 250, qty: 2 }])).toBe("1 item(s), total 5.00");
});
