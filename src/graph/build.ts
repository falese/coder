import type { Episode } from "../episodes/types.js";
import type { GraphNode, GraphEdge, KnowledgeGraph } from "./types.js";

function normalize(thread: string): string {
  return thread.trim().toLowerCase();
}

/**
 * Build a knowledge graph from episodes. Nodes = concept threads (normalised),
 * carrying an episode mention count; edges = within-episode co-occurrence,
 * weighted by the number of episodes a concept pair shares. Pure — deterministic
 * for a given episode set (nodes sorted by count desc then id; edges by weight
 * desc then source/target).
 */
export function buildGraph(episodes: Episode[], builtAt: string = new Date().toISOString()): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  for (const ep of episodes) {
    // De-duplicate threads within an episode by normalised id (keep first label).
    const present = new Map<string, string>();
    for (const raw of ep.threads) {
      const id = normalize(raw);
      if (id.length === 0) continue;
      if (!present.has(id)) present.set(id, raw.trim());
    }

    for (const [id, label] of present) {
      const node = nodes.get(id);
      if (node) {
        node.count += 1;
        node.episodes.push(ep.id);
      } else {
        nodes.set(id, { id, label, count: 1, episodes: [ep.id] });
      }
    }

    // Co-occurrence edges over unordered distinct pairs in this episode.
    // Key via JSON.stringify so concepts containing spaces never collide.
    const ids = [...present.keys()].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = JSON.stringify([ids[i], ids[j]]);
        const edge = edges.get(key);
        if (edge) edge.weight += 1;
        else edges.set(key, { source: ids[i], target: ids[j], weight: 1 });
      }
    }
  }

  const nodeList = [...nodes.values()].sort(
    (a, b) => b.count - a.count || a.id.localeCompare(b.id),
  );
  const edgeList = [...edges.values()].sort(
    (a, b) =>
      b.weight - a.weight ||
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target),
  );

  return { nodes: nodeList, edges: edgeList, builtAt };
}
