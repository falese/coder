import type { KnowledgeGraph } from "./types.js";

export interface Neighbor {
  id: string;
  label: string;
  weight: number;
}

function labelOf(graph: KnowledgeGraph, id: string): string {
  return graph.nodes.find((n) => n.id === id)?.label ?? id;
}

/**
 * Return the concepts adjacent to `concept` (matched case-insensitively),
 * sorted by edge weight descending. Empty when the concept is absent.
 */
export function neighbors(graph: KnowledgeGraph, concept: string): Neighbor[] {
  const id = concept.trim().toLowerCase();
  const out: Neighbor[] = [];
  for (const e of graph.edges) {
    if (e.source === id) out.push({ id: e.target, label: labelOf(graph, e.target), weight: e.weight });
    else if (e.target === id) out.push({ id: e.source, label: labelOf(graph, e.source), weight: e.weight });
  }
  return out.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
}

/** The `n` most-mentioned concepts (nodes are already count-sorted by build). */
export function topNodes(graph: KnowledgeGraph, n: number): KnowledgeGraph["nodes"] {
  return graph.nodes.slice(0, Math.max(0, n));
}
