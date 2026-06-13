/**
 * Knowledge graph over concept threads.
 *
 * Nodes are concepts (normalised thread text); edges are within-episode
 * co-occurrences. The graph is the structural seed for baking episode knowledge
 * into training data (consumption = bake; inference-time retrieval is out of
 * scope per docs/spec.md).
 */
export interface GraphNode {
  /** Normalised (lowercased) thread text — the stable id. */
  id: string;
  /** First-seen display form. */
  label: string;
  /** Number of episodes mentioning this concept. */
  count: number;
  /** Episode ids mentioning this concept. */
  episodes: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
  /** Number of episodes in which both concepts co-occur. */
  weight: number;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  builtAt: string;
}
