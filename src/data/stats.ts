import type { JsonlRecord } from "./types.js";

export interface TokenStats {
  mean: number;
  p50: number;
  p95: number;
}

export interface DataStats {
  count: number;
  promptTokens: TokenStats;
  completionTokens: TokenStats;
  duplicateRate: number;
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function tokenStats(lengths: number[]): TokenStats {
  if (lengths.length === 0) return { mean: 0, p50: 0, p95: 0 };

  const sorted = lengths.slice().sort((a, b) => a - b);
  const mean = lengths.reduce((s, v) => s + v, 0) / lengths.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];

  return { mean, p50, p95 };
}

function countDuplicates(records: JsonlRecord[]): number {
  const seen = new Set<string>();
  let dupes = 0;
  for (const r of records) {
    const key = r.prompt + "\x00" + r.completion;
    if (seen.has(key)) {
      dupes++;
    } else {
      seen.add(key);
    }
  }
  return dupes;
}

export function computeStats(records: JsonlRecord[]): DataStats {
  if (records.length === 0) {
    return {
      count: 0,
      promptTokens: { mean: 0, p50: 0, p95: 0 },
      completionTokens: { mean: 0, p50: 0, p95: 0 },
      duplicateRate: 0,
    };
  }

  const promptLengths = records.map((r) => estimateTokens(r.prompt));
  const completionLengths = records.map((r) => estimateTokens(r.completion));
  const dupes = countDuplicates(records);

  return {
    count: records.length,
    promptTokens: tokenStats(promptLengths),
    completionTokens: tokenStats(completionLengths),
    duplicateRate: dupes / records.length,
  };
}
