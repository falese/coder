import { describe, test, expect } from "bun:test";
import { computeStats } from "../../src/data/stats.js";
import type { JsonlRecord } from "../../src/data/types.js";

describe("computeStats", () => {
  test("returns zero stats for empty input", () => {
    const stats = computeStats([]);
    expect(stats.count).toBe(0);
    expect(stats.promptTokens.mean).toBe(0);
    expect(stats.completionTokens.mean).toBe(0);
    expect(stats.duplicateRate).toBe(0);
  });

  test("counts records correctly", () => {
    const records: JsonlRecord[] = [
      { prompt: "a", completion: "b" },
      { prompt: "c", completion: "d" },
      { prompt: "e", completion: "f" },
    ];
    const stats = computeStats(records);
    expect(stats.count).toBe(3);
  });

  test("estimates tokens as ceil(chars / 4)", () => {
    // prompt "abcd" = 4 chars → 1 token; completion "abcdefgh" = 8 chars → 2 tokens
    const records: JsonlRecord[] = [
      { prompt: "abcd", completion: "abcdefgh" },
    ];
    const stats = computeStats(records);
    expect(stats.promptTokens.mean).toBe(1);
    expect(stats.completionTokens.mean).toBe(2);
  });

  test("computes mean token length", () => {
    // prompts: 4 chars (1 tok), 8 chars (2 tok) → mean = 1.5
    const records: JsonlRecord[] = [
      { prompt: "abcd", completion: "x" },
      { prompt: "abcdefgh", completion: "x" },
    ];
    const stats = computeStats(records);
    expect(stats.promptTokens.mean).toBe(1.5);
  });

  test("computes p50 (median) token length", () => {
    // 3 records with prompt tokens: 1, 2, 3 → p50 = index floor(3*0.5)=1 of sorted [1,2,3] → 2
    const records: JsonlRecord[] = [
      { prompt: "a", completion: "x" },        // 1 tok
      { prompt: "aaaaaaaa", completion: "x" },  // 2 tok
      { prompt: "aaaaaaaaaaaa", completion: "x" }, // 3 tok
    ];
    const stats = computeStats(records);
    expect(stats.promptTokens.p50).toBe(2);
  });

  test("computes p95 token length", () => {
    // 20 records each with 1 token prompt except the last with 20 tokens
    const records: JsonlRecord[] = Array.from({ length: 19 }, () => ({
      prompt: "ab",        // ceil(2/4) = 1 tok
      completion: "x",
    }));
    records.push({ prompt: "a".repeat(80), completion: "x" }); // 20 tok

    const stats = computeStats(records);
    // p95 = index floor(20*0.95) = 19 of sorted → 20
    expect(stats.promptTokens.p95).toBe(20);
  });

  test("reports duplicate rate", () => {
    // 3 records, 1 exact duplicate → duplicate rate = 1/3
    const records: JsonlRecord[] = [
      { prompt: "p", completion: "c" },
      { prompt: "p", completion: "c" }, // duplicate
      { prompt: "other", completion: "d" },
    ];
    const stats = computeStats(records);
    expect(stats.duplicateRate).toBeCloseTo(1 / 3);
  });

  test("reports zero duplicate rate when all records are unique", () => {
    const records: JsonlRecord[] = [
      { prompt: "a", completion: "1" },
      { prompt: "b", completion: "2" },
    ];
    const stats = computeStats(records);
    expect(stats.duplicateRate).toBe(0);
  });
});
