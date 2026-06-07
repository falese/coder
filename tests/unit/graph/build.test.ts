import { describe, test, expect } from "bun:test";
import { buildGraph } from "../../../src/graph/build.js";
import type { Episode } from "../../../src/episodes/types.js";

function ep(id: string, threads: string[]): Episode {
  return {
    id,
    sessionId: id,
    startedAt: "2026-06-01T00:00:00.000Z",
    endedAt: "2026-06-01T00:00:00.000Z",
    model: "m",
    turns: [],
    threads,
  };
}

describe("buildGraph", () => {
  test("nodes carry mention counts and episode ids", () => {
    const g = buildGraph([ep("e1", ["State machines", "Retry"]), ep("e2", ["state machines"])], "T");
    const sm = g.nodes.find((n) => n.id === "state machines");
    expect(sm?.count).toBe(2);
    expect(sm?.episodes).toEqual(["e1", "e2"]);
    expect(sm?.label).toBe("State machines"); // first-seen label
    expect(g.builtAt).toBe("T");
  });

  test("edges weight by number of co-occurring episodes", () => {
    const g = buildGraph([ep("e1", ["a", "b"]), ep("e2", ["a", "b"]), ep("e3", ["a", "c"])], "T");
    const ab = g.edges.find((e) => e.source === "a" && e.target === "b");
    const ac = g.edges.find((e) => e.source === "a" && e.target === "c");
    expect(ab?.weight).toBe(2);
    expect(ac?.weight).toBe(1);
  });

  test("de-duplicates threads within an episode (no self counting)", () => {
    const g = buildGraph([ep("e1", ["a", "a", "b"])], "T");
    expect(g.nodes.find((n) => n.id === "a")?.count).toBe(1);
    expect(g.edges).toHaveLength(1); // single a-b edge
  });

  test("is deterministic and sorted (nodes by count desc, edges by weight desc)", () => {
    const g = buildGraph([ep("e1", ["a", "b"]), ep("e2", ["a", "b"]), ep("e3", ["a"])], "T");
    expect(g.nodes[0].id).toBe("a"); // count 3 first
    expect(g.edges[0].weight).toBe(2);
  });

  test("empty input yields an empty graph", () => {
    const g = buildGraph([], "T");
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });
});
