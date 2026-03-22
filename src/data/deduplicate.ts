import type { JsonlRecord } from "./types.js";

const JACCARD_THRESHOLD = 0.85;

function trigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i <= s.length - 3; i++) {
    set.add(s.slice(i, i + 3));
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

export function deduplicate(records: JsonlRecord[]): {
  records: JsonlRecord[];
  removed: number;
} {
  // Pass 1: exact dedup
  const exactSeen = new Set<string>();
  const afterExact: JsonlRecord[] = [];
  for (const r of records) {
    const key = r.prompt + "\x00" + r.completion;
    if (!exactSeen.has(key)) {
      exactSeen.add(key);
      afterExact.push(r);
    }
  }

  // Pass 2: near-dedup via Jaccard on character trigrams of prompt+completion
  const kept: JsonlRecord[] = [];
  const keptTrigrams: Set<string>[] = [];

  for (const r of afterExact) {
    const tg = trigrams(r.prompt + r.completion);
    let isDup = false;
    for (const existing of keptTrigrams) {
      if (jaccard(tg, existing) >= JACCARD_THRESHOLD) {
        isDup = true;
        break;
      }
    }
    if (!isDup) {
      kept.push(r);
      keptTrigrams.push(tg);
    }
  }

  return {
    records: kept,
    removed: records.length - kept.length,
  };
}
