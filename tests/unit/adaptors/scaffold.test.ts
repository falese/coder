import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scaffoldPersonaAdaptor } from "../../../src/adaptors/scaffold.js";
import { saveEpisode } from "../../../src/episodes/store.js";
import { ManifestSchema } from "../../../src/adaptors/types.js";
import { loadTrainConfig } from "../../../src/training/config.js";
import type { Episode } from "../../../src/episodes/types.js";

let episodesDir: string;
let adaptorsDir: string;

beforeEach(() => {
  episodesDir = mkdtempSync(join(tmpdir(), "coder-eps-"));
  adaptorsDir = mkdtempSync(join(tmpdir(), "coder-ad-"));
});
afterEach(() => {
  rmSync(episodesDir, { recursive: true, force: true });
  rmSync(adaptorsDir, { recursive: true, force: true });
});

function makeEpisode(i: number): Episode {
  const ts = `2026-06-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`;
  return {
    id: `ep${String(i)}`,
    sessionId: `s${String(i)}`,
    startedAt: ts,
    endedAt: ts,
    model: "/models/test",
    turns: [
      { role: "user", content: `question ${String(i)}`, ts },
      {
        role: "assistant",
        content: `answer ${String(i)}\n<threads>{"threads":["concept${String(i)}","shared"]}</threads>`,
        threads: [`concept${String(i)}`, "shared"],
        ts,
      },
    ],
    threads: [`concept${String(i)}`, "shared"],
  };
}

function readJsonl(path: string): unknown[] {
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as unknown);
}

describe("scaffoldPersonaAdaptor", () => {
  test("builds a valid pack from episodes with deterministic split", () => {
    for (let i = 0; i < 10; i++) saveEpisode(episodesDir, makeEpisode(i));

    const result = scaffoldPersonaAdaptor({
      name: "persona-me",
      episodesDir,
      adaptorsDir,
      baseModel: "/models/test",
    });

    expect(result.episodeCount).toBe(10);
    expect(result.recordCount).toBe(10);
    expect(result.trainCount).toBe(9);
    expect(result.evalCount).toBe(1);

    const packDir = join(adaptorsDir, "persona-me");
    // manifest is schema-valid
    const manifest = JSON.parse(readFileSync(join(packDir, "manifest.json"), "utf-8")) as unknown;
    expect(() => ManifestSchema.parse(manifest)).not.toThrow();
    expect((manifest as { domain: string }).domain).toBe("persona");

    // train-config is schema-valid and loadable
    expect(() => loadTrainConfig(join(packDir, "train-config.toml"))).not.toThrow();

    // data files
    const train = readJsonl(join(packDir, "data", "train.jsonl"));
    expect(train).toHaveLength(9);
    expect(train[0]).toHaveProperty("prompt");
    expect(train[0]).toHaveProperty("completion");
    // completions are voice-only (threads stripped)
    expect(JSON.stringify(train[0])).not.toContain("<threads>");

    const pool = readJsonl(join(packDir, "data", "persona-pool.jsonl"));
    expect(pool).toHaveLength(9);
    expect(pool[0]).toHaveProperty("threads");

    const evalRefs = readJsonl(join(packDir, "data", "persona-eval.jsonl")) as { threads: string[] }[];
    expect(evalRefs).toHaveLength(1);
    expect(evalRefs[0].threads.length).toBeGreaterThan(0);
  });

  test("dedupes identical records", () => {
    // two identical episodes → one persona record
    saveEpisode(episodesDir, { ...makeEpisode(0), id: "a", startedAt: "2026-06-01T00:00:00.000Z" });
    saveEpisode(episodesDir, { ...makeEpisode(0), id: "b", startedAt: "2026-06-02T00:00:00.000Z" });
    const result = scaffoldPersonaAdaptor({ name: "p", episodesDir, adaptorsDir, baseModel: "m" });
    expect(result.recordCount).toBe(1);
  });

  test("warns via placeholder when base model is empty", () => {
    saveEpisode(episodesDir, makeEpisode(0));
    scaffoldPersonaAdaptor({ name: "p", episodesDir, adaptorsDir, baseModel: "" });
    const toml = readFileSync(join(adaptorsDir, "p", "train-config.toml"), "utf-8");
    expect(toml).toContain("REPLACE_WITH_MODEL_PATH");
    expect(existsSync(join(adaptorsDir, "p", "manifest.json"))).toBe(true);
  });
});
