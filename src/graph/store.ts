import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeGraph } from "./types.js";

const GRAPH_FILE = "knowledge-graph.json";

/** Persist the graph as `<dir>/knowledge-graph.json`; returns the written path. */
export function saveGraph(dir: string, graph: KnowledgeGraph): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, GRAPH_FILE);
  writeFileSync(path, JSON.stringify(graph, null, 2) + "\n");
  return path;
}

/** Load the graph, or null when it has not been built yet / is unreadable. */
export function loadGraph(dir: string): KnowledgeGraph | null {
  const path = join(dir, GRAPH_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as KnowledgeGraph;
  } catch {
    return null;
  }
}
