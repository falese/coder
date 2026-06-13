import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveEpisode, loadEpisode, listEpisodes, episodeToJsonl, episodeToPersonaRecords } from "../../../src/episodes/store.js";
import type { Episode } from "../../../src/episodes/types.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "coder-eps-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeEpisode(id: string, startedAt: string): Episode {
  return {
    id,
    sessionId: "s1",
    startedAt,
    endedAt: startedAt,
    model: "/models/test",
    turns: [
      { role: "user", content: "how do I debounce?", ts: startedAt },
      {
        role: "assistant",
        content: 'use a timer\n<threads>{"threads":["debounce","timers"]}</threads>',
        thought: "thinking...",
        threads: ["debounce", "timers"],
        ts: startedAt,
      },
    ],
    threads: ["debounce", "timers"],
  };
}

describe("saveEpisode / loadEpisode / listEpisodes", () => {
  test("round-trips an episode", () => {
    const ep = makeEpisode("a", "2026-06-01T00:00:00.000Z");
    saveEpisode(dir, ep);
    expect(loadEpisode(dir, "a")).toEqual(ep);
  });

  test("loadEpisode returns null when absent", () => {
    expect(loadEpisode(dir, "missing")).toBeNull();
  });

  test("listEpisodes returns all, sorted by startedAt", () => {
    saveEpisode(dir, makeEpisode("b", "2026-06-02T00:00:00.000Z"));
    saveEpisode(dir, makeEpisode("a", "2026-06-01T00:00:00.000Z"));
    expect(listEpisodes(dir).map((e) => e.id)).toEqual(["a", "b"]);
  });

  test("listEpisodes on a missing dir is []", () => {
    expect(listEpisodes(join(dir, "nope"))).toEqual([]);
  });
});

describe("episodeToJsonl", () => {
  test("emits one record per assistant turn with threads stripped from completion", () => {
    const ep = makeEpisode("a", "2026-06-01T00:00:00.000Z");
    const records = episodeToJsonl(ep);
    expect(records).toHaveLength(1);
    expect(records[0].completion).toBe("use a timer");
    expect(records[0].prompt).toContain("how do I debounce?");
    expect(records[0].prompt).toContain("<|im_start|>");
  });

  test("skips assistant turns with no preceding history", () => {
    const ep: Episode = {
      id: "x",
      sessionId: "s",
      startedAt: "2026-06-01T00:00:00.000Z",
      endedAt: "2026-06-01T00:00:00.000Z",
      model: "m",
      turns: [{ role: "assistant", content: "orphan", ts: "2026-06-01T00:00:00.000Z" }],
      threads: [],
    };
    expect(episodeToJsonl(ep)).toEqual([]);
  });
});

describe("episodeToPersonaRecords", () => {
  test("carries voice-only completion + the turn's reference threads", () => {
    const ep = makeEpisode("a", "2026-06-01T00:00:00.000Z");
    const recs = episodeToPersonaRecords(ep);
    expect(recs).toHaveLength(1);
    expect(recs[0].completion).toBe("use a timer"); // threads stripped
    expect(recs[0].threads).toEqual(["debounce", "timers"]);
    expect(recs[0].prompt).toContain("how do I debounce?");
  });
});
