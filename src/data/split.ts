import type { JsonlRecord } from "./types.js";

export interface SplitOptions {
  trainRatio?: number;
  seed?: number;
}

export interface SplitResult {
  train: JsonlRecord[];
  eval: JsonlRecord[];
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function splitRecords(
  records: JsonlRecord[],
  options: SplitOptions = {},
): SplitResult {
  const trainRatio = options.trainRatio ?? 0.9;
  const seed = options.seed ?? 42;

  const rng = seededRandom(seed);
  const shuffled = shuffle(records, rng);
  const trainCount = Math.floor(shuffled.length * trainRatio);

  return {
    train: shuffled.slice(0, trainCount),
    eval: shuffled.slice(trainCount),
  };
}
