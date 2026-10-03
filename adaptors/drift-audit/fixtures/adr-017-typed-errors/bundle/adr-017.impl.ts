// packages/core/src/checkout.ts
// The code that is supposed to carry ADR-017, captured BEFORE the typed-errors
// migration. It still raises bare Error()s in domain code.

import type { Cart, Payment } from "./types";

export function beginCheckout(cart: Cart): void {
  if (cart.items.length === 0) {
    throw new Error("cart empty");
  }
}

export function capturePayment(payment: Payment): void {
  if (payment.status === "declined") {
    throw new Error(`payment declined: ${payment.reason}`);
  }
}
