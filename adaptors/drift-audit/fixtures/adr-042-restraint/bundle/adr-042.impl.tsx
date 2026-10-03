// packages/ui/src/widgets/*  — supposed to carry ADR-042.
// Nothing here clearly violates the rule: data comes through useQuery hooks.
// Two files sit near the boundary, which is a job for ranked low-confidence
// suspects — NOT a fabricated high-confidence hardened finding.

import { usePriceQuery } from "../hooks/usePriceQuery";
import { apiClient } from "../api/client";

export function PriceTicker(): JSX.Element {
  // Goes through the hooks layer — compliant.
  const { data } = usePriceQuery();
  // apiClient is imported but only its type is referenced below; a reviewer
  // would want to confirm it is never called directly here.
  const _clientType: typeof apiClient | undefined = undefined;
  return <span>{data?.price ?? "—"}</span>;
}

export function LiveFeed(): JSX.Element {
  const { data } = usePriceQuery();
  return <ul>{(data?.items ?? []).map((i) => <li key={i.id}>{i.label}</li>)}</ul>;
}
