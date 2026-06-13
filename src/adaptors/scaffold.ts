import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listEpisodes, episodeToPersonaRecords } from "../episodes/store.js";
import type { PersonaRecord } from "../episodes/store.js";
import type { AdaptorManifest } from "./types.js";
import type { TrainConfig } from "../training/config.js";

export interface ScaffoldOptions {
  name: string;
  episodesDir: string;
  adaptorsDir: string;
  baseModel: string;
  /** Fraction of records used for training; the remainder is held out for eval. */
  trainRatio?: number;
}

export interface ScaffoldResult {
  packDir: string;
  episodeCount: number;
  recordCount: number;
  trainCount: number;
  evalCount: number;
}

function dedupe(records: PersonaRecord[]): PersonaRecord[] {
  const seen = new Set<string>();
  const out: PersonaRecord[] = [];
  for (const r of records) {
    const key = JSON.stringify([r.prompt, r.completion]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function writeJsonl(path: string, rows: unknown[]): void {
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : ""));
}

/** Serialize a TrainConfig to TOML (manual — round-trips through `loadTrainConfig`). */
function trainConfigToToml(c: TrainConfig): string {
  const q = (s: string): string => JSON.stringify(s); // TOML basic string (JSON escapes are compatible)
  const arr = (xs: string[]): string => `[${xs.map(q).join(", ")}]`;
  return [
    `[model]`,
    `path = ${q(c.model.path)}`,
    ``,
    `[lora]`,
    `rank = ${String(c.lora.rank)}`,
    `target_modules = ${arr(c.lora.target_modules)}`,
    `iters = ${String(c.lora.iters)}`,
    `batch_size = ${String(c.lora.batch_size)}`,
    `learning_rate = ${String(c.lora.learning_rate)}`,
    ``,
    `[data]`,
    `dir = ${q(c.data.dir)}`,
    ``,
    `[output]`,
    `adaptor_dir = ${q(c.output.adaptor_dir)}`,
    `manifest = ${q(c.output.manifest)}`,
    `log_file = ${q(c.output.log_file)}`,
    ``,
  ].join("\n");
}

/**
 * Scaffold a persona adaptor pack from captured episodes. Builds a
 * manifest + train-config + the data files the SSD persona loop consumes:
 *   data/train.jsonl        — {prompt, completion} voice seed (train split)
 *   data/persona-pool.jsonl — {prompt, threads}     in-loop sampling pool + refs
 *   data/persona-eval.jsonl — {prompt, threads}     held-out gate/eval refs
 *
 * Dedupe + split are deterministic (by order, not the shuffling `splitRecords`)
 * so scaffolds are reproducible and testable.
 */
export function scaffoldPersonaAdaptor(opts: ScaffoldOptions): ScaffoldResult {
  const trainRatio = opts.trainRatio ?? 0.9;
  const packDir = join(opts.adaptorsDir, opts.name);
  const dataDir = join(packDir, "data");
  mkdirSync(dataDir, { recursive: true });

  const episodes = listEpisodes(opts.episodesDir);
  const records = dedupe(episodes.flatMap((ep) => episodeToPersonaRecords(ep)));

  // Deterministic split by order; keep >=1 train and >=1 eval when possible.
  const n = records.length;
  const trainCount =
    n <= 1 ? n : Math.min(n - 1, Math.max(1, Math.floor(n * trainRatio)));
  const trainRecords = records.slice(0, trainCount);
  const evalRecords = records.slice(trainCount);

  writeJsonl(
    join(dataDir, "train.jsonl"),
    trainRecords.map((r) => ({ prompt: r.prompt, completion: r.completion })),
  );
  writeJsonl(
    join(dataDir, "persona-pool.jsonl"),
    trainRecords.filter((r) => r.threads.length > 0).map((r) => ({ prompt: r.prompt, threads: r.threads })),
  );
  writeJsonl(
    join(dataDir, "persona-eval.jsonl"),
    evalRecords.filter((r) => r.threads.length > 0).map((r) => ({ prompt: r.prompt, threads: r.threads })),
  );

  const modelPath = opts.baseModel.length > 0 ? opts.baseModel : "REPLACE_WITH_MODEL_PATH";

  const manifest: AdaptorManifest = {
    name: opts.name,
    version: "0.1.0",
    domain: "persona",
    base_model: opts.baseModel,
    mlx_quant: "4bit",
    lora_rank: 8,
    min_memory_gb: 18,
    eval_pass_rate: 0,
    author: "",
    description: `Persona/voice adaptor scaffolded from ${String(episodes.length)} episode(s).`,
  };
  writeFileSync(join(packDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const trainConfig: TrainConfig = {
    model: { path: modelPath },
    lora: {
      rank: 8,
      target_modules: ["q_proj", "v_proj"],
      iters: 100,
      batch_size: 2,
      learning_rate: 1e-4,
    },
    data: { dir: dataDir },
    output: {
      adaptor_dir: join(packDir, "weights"),
      manifest: join(packDir, "manifest.json"),
      log_file: join(packDir, "training.log"),
    },
  };
  writeFileSync(join(packDir, "train-config.toml"), trainConfigToToml(trainConfig));

  return {
    packDir,
    episodeCount: episodes.length,
    recordCount: n,
    trainCount: trainRecords.length,
    evalCount: evalRecords.length,
  };
}
