// packages/api/src/webhooks/stripe.ts
// Supposed to carry ADR-030. The dedupe guard exists — but it runs AFTER the
// ledger side effect, so a retried event double-writes. No single regex catches
// "the guard is in the wrong order relative to the side effect".

import { ledger } from "../../ledger";
import { seenEvents } from "../../dedupe";

export function handleCharge(event: StripeEvent): void {
  const charge = event.data.object;

  // side effect happens first…
  ledger.record(charge);

  // …and only then do we check whether we already processed this event.
  if (seenEvents.has(event.id)) {
    return;
  }
  seenEvents.add(event.id);
}
