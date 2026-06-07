import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../../../src/graph/build.js";
import { saveGraph, loadGraph } from "../../../src/graph/store.js";
import { neighbors, topNodes } from "../../../src/graph/query.js";
import type { Episode } from "../../../src/episodes/types.js";

function ep(id: string, threads: string[]): Episode {
  return {
    id, sessionId: id, startedAt: "2026-06-01T00:00:00.000Z", endedAt: "2026-06-01T00:00:00.000Z",
    model: "m", turns: [], threads,
  };
}

const graph = buildGraph(
  [ep("e1", ["a", "b"]), ep("e2", ["a", "b"]), ep("e3", ["a", "c"])],
  "T",
);

describe("neighbors", () => {
  test("returns adjacent concepts sorted by weight desc", () => {
    const n = neighbors(graph, "a");
    expect(n.map((x) => x.id)).toEqual(["b", "c"]);
    expect(n[0].weight).toBe(2);
  });

  test("is case-insensitive on the query", () => {
    expect(neighbors(graph, "A").map((x) => x.id)).toEqual(["b", "c"]);
  });

  test("unknown concept yields []", () => {
    expect(neighbors(graph, "zzz")).toEqual([]);
  });
});

describe("topNodes", () => {
  test("returns the n most-mentioned concepts", () => {
    expect(topNodes(graph, 1).map((n) => n.id)).toEqual(["a"]);
  });
});

describe("saveGraph / loadGraph", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "coder-graph-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("round-trips the graph", () => {
    saveGraph(dir, graph);
    expect(loadGraph(dir)).toEqual(graph);
  });

  test("loadGraph returns null before build", () => {
    expect(loadGraph(dir)).toBeNull();
  });
});
