import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSessionRecorder } from "../../../src/episodes/recorder.js";
import { loadEpisode, listEpisodes } from "../../../src/episodes/store.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "coder-rec-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("SessionRecorder", () => {
  test("accumulates multiple exchanges into one episode and merges threads", () => {
    const rec = createSessionRecorder({ dir, model: "m" });
    rec.record("s1", { userContent: "q1", final: "a1", thought: "t1", threads: ["x", "y"] });
    rec.record("s1", { userContent: "q2", final: "a2", threads: ["y", "z"] });

    const ep = rec.save("s1");
    expect(ep).not.toBeNull();
    expect(ep?.turns).toHaveLength(4); // 2 user + 2 assistant
    expect(ep?.threads).toEqual(["x", "y", "z"]); // deduped, first-seen order
    // persisted to disk
    const reloaded = ep ? loadEpisode(dir, ep.id) : null;
    expect(reloaded?.turns).toHaveLength(4);
  });

  test("save() on an unknown session returns null", () => {
    const rec = createSessionRecorder({ dir, model: "m" });
    expect(rec.save("nope")).toBeNull();
  });

  test("save() clears the session (no double-write)", () => {
    const rec = createSessionRecorder({ dir, model: "m" });
    rec.record("s1", { userContent: "q", final: "a" });
    rec.save("s1");
    expect(rec.has("s1")).toBe(false);
    expect(rec.save("s1")).toBeNull();
  });

  test("flushIdle persists only sessions past the idle threshold", () => {
    let clock = 1_000;
    const rec = createSessionRecorder({ dir, model: "m", now: () => clock });
    rec.record("old", { userContent: "q", final: "a" });
    clock = 100_000;
    rec.record("fresh", { userContent: "q", final: "a" });

    const flushed = rec.flushIdle(clock, 5_000);
    expect(flushed.map((e) => e.sessionId)).toEqual(["old"]);
    expect(rec.has("old")).toBe(false);
    expect(rec.has("fresh")).toBe(true);
    expect(listEpisodes(dir)).toHaveLength(1);
  });

  test("flushAll persists every open session", () => {
    const rec = createSessionRecorder({ dir, model: "m" });
    rec.record("a", { userContent: "q", final: "a" });
    rec.record("b", { userContent: "q", final: "a" });
    expect(rec.flushAll()).toHaveLength(2);
    expect(listEpisodes(dir)).toHaveLength(2);
  });
});
