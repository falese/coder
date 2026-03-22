import { describe, test, expect } from "bun:test";
import { splitRecords } from "../../src/data/split.js";
import type { JsonlRecord } from "../../src/data/types.js";

function makeRecords(n: number): JsonlRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    prompt: `prompt ${String(i)}`,
    completion: `completion ${String(i)}`,
  }));
}

describe("splitRecords", () => {
  test("returns 90/10 split by default", () => {
    const records = makeRecords(100);
    const { train, eval: evalSet } = splitRecords(records);
    expect(train).toHaveLength(90);
    expect(evalSet).toHaveLength(10);
  });

  test("respects custom trainRatio", () => {
    const records = makeRecords(100);
    const { train, eval: evalSet } = splitRecords(records, { trainRatio: 0.8 });
    expect(train).toHaveLength(80);
    expect(evalSet).toHaveLength(20);
  });

  test("all input records appear in output (no data lost)", () => {
    const records = makeRecords(50);
    const { train, eval: evalSet } = splitRecords(records);
    const all = [...train, ...evalSet];
    expect(all).toHaveLength(50);

    // every original record appears exactly once
    for (const r of records) {
      const found = all.filter(
        (x) => x.prompt === r.prompt && x.completion === r.completion,
      );
      expect(found).toHaveLength(1);
    }
  });

  test("same seed produces same split", () => {
    const records = makeRecords(20);
    const first = splitRecords(records, { seed: 99 });
    const second = splitRecords(records, { seed: 99 });
    expect(first.train.map((r) => r.prompt)).toEqual(
      second.train.map((r) => r.prompt),
    );
  });

  test("different seeds produce different splits", () => {
    const records = makeRecords(20);
    const a = splitRecords(records, { seed: 1 });
    const b = splitRecords(records, { seed: 2 });
    // Highly unlikely to be identical for 20 records
    expect(a.train.map((r) => r.prompt)).not.toEqual(
      b.train.map((r) => r.prompt),
    );
  });

  test("handles small dataset (fewer than 10 records)", () => {
    const records = makeRecords(5);
    const { train, eval: evalSet } = splitRecords(records);
    expect(train.length + evalSet.length).toBe(5);
    expect(train.length).toBeGreaterThanOrEqual(4); // 90% of 5 = 4.5 → 4 or 5
  });

  test("default seed (42) is deterministic across calls", () => {
    const records = makeRecords(30);
    const first = splitRecords(records);
    const second = splitRecords(records);
    expect(first.train.map((r) => r.prompt)).toEqual(
      second.train.map((r) => r.prompt),
    );
  });
});
