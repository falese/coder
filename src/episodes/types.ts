/**
 * Episode = a persisted multi-turn thinking session.
 *
 * Each exchange contributes a user turn (the input) and an assistant turn (the
 * model's response, split into reasoning `thought` and the crystallised `final`,
 * plus the concept `threads` extracted from the answer). `threads` on the
 * Episode is the de-duplicated union across all assistant turns — the seed of
 * the knowledge graph.
 */
export interface EpisodeTurn {
  role: "user" | "assistant";
  content: string;
  /** Reasoning channel (assistant turns only). */
  thought?: string;
  /** Concept threads extracted from this turn (assistant turns only). */
  threads?: string[];
  ts: string;
}

export interface Episode {
  id: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  model: string;
  adaptor?: string;
  turns: EpisodeTurn[];
  /** Union of all turn threads, de-duplicated, in first-seen order. */
  threads: string[];
}
