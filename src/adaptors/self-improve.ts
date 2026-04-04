import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  unlinkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sampleCompletions } from "../inference/sampler.js";
import { runMlxTrain } from "../training/runner.js";
import { runEval } from "../eval/runner.js";
import { deduplicate } from "../data/deduplicate.js";
import type { TrainConfig } from "../training/config.js";
import type { EvalSummary } from "../eval/runner.js";
import type { SampleResult } from "../inference/sampler.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SelfImproveOptions {
  adaptorDir: string;
  modelPath: string;
  rounds: number;
  samplesPerPrompt: number;
  threshold: number;
  temperature: number | "adaptive"; // "adaptive" resolved to 0.7; full schedule is #32
  dryRun: boolean;
}

export interface RoundResult {
  round: number;
  generated: number;
  filtered: number;
  scoreBefore: number;
  scoreAfter: number;
  committed: boolean;
}

// ---------------------------------------------------------------------------
// Injectable dependencies (for testing)
// ---------------------------------------------------------------------------

interface SelfImproveDeps {
  sampleFn: (
    prompts: string[],
    k: number,
    temperature: number,
    opts: { model: string; adaptor?: string },
    evalOpts: { adaptorDir: string },
  ) => Promise<SampleResult[]>;
  trainFn: typeof runMlxTrain;
  evalFn: (
    adaptorDir: string,
    opts: Parameters<typeof runEval>[1],
  ) => Promise<EvalSummary>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface JsonlPair {
  prompt: string;
  completion: string;
}

function loadJsonlPairs(filePath: string): JsonlPair[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8").trim();
  if (!content) return [];
  return content
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as JsonlPair);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runSelfImprove(
  opts: SelfImproveOptions,
  deps: Partial<SelfImproveDeps> = {},
): Promise<RoundResult[]> {
  const sampleFn = deps.sampleFn ?? sampleCompletions;
  const trainFn = deps.trainFn ?? runMlxTrain;
  const evalFn = deps.evalFn ?? runEval;

  const weightsDir = join(opts.adaptorDir, "weights");
  const checkpointFile = join(weightsDir, "adapters.safetensors");
  const backupFile = join(weightsDir, "adapters.safetensors.bak");

  // Load eval prompts and original train pairs
  const evalPairs = loadJsonlPairs(join(opts.adaptorDir, "data", "eval.jsonl"));
  const prompts = evalPairs.map((r) => r.prompt);
  const originalTrainPairs = loadJsonlPairs(join(opts.adaptorDir, "data", "train.jsonl"));

  // Establish baseline score before round 1
  let currentScore = (
    await evalFn(opts.adaptorDir, {
      modelPath: opts.modelPath,
      adaptorPath: weightsDir,
      dryRun: opts.dryRun,
    })
  ).meanComposite;

  const results: RoundResult[] = [];

  for (let round = 1; round <= opts.rounds; round++) {
    const scoreBefore = currentScore;
    const temp =
      opts.temperature === "adaptive" ? 0.7 : opts.temperature;

    // Sample K completions per prompt
    const samples = await sampleFn(
      prompts,
      opts.samplesPerPrompt,
      temp,
      { model: opts.modelPath, adaptor: weightsDir },
      { adaptorDir: opts.adaptorDir },
    );

    // Filter by threshold
    const filtered = samples.filter((s) => s.composite >= opts.threshold);

    if (filtered.length === 0) {
      results.push({
        round,
        generated: samples.length,
        filtered: 0,
        scoreBefore,
        scoreAfter: scoreBefore,
        committed: false,
      });
      continue;
    }

    // Merge filtered pairs with original train data and deduplicate
    const newPairs: JsonlPair[] = filtered.map((s) => ({
      prompt: s.prompt,
      completion: s.completion,
    }));
    const merged = deduplicate([...originalTrainPairs, ...newPairs]).records;

    // Write merged data to a temp directory (mlx_lm.lora --data expects a dir)
    const tempDataDir = mkdtempSync(join(tmpdir(), "coder-ssd-"));
    try {
      writeFileSync(
        join(tempDataDir, "train.jsonl"),
        merged.map((r) => JSON.stringify(r)).join("\n") + "\n",
      );

      // Backup checkpoint before training
      if (existsSync(checkpointFile)) {
        copyFileSync(checkpointFile, backupFile);
      }

      // Build TrainConfig and retrain
      mkdirSync(weightsDir, { recursive: true });
      const config: TrainConfig = {
        model: { path: opts.modelPath },
        lora: {
          rank: 8,
          target_modules: ["q_proj", "v_proj"],
          iters: 100,
          batch_size: 2,
          learning_rate: 1e-4,
        },
        data: { dir: tempDataDir },
        output: {
          adaptor_dir: weightsDir,
          manifest: join(opts.adaptorDir, "manifest.json"),
          log_file: join(opts.adaptorDir, "training.log"),
        },
      };
      await trainFn(config, opts.dryRun);

      // Gate: evaluate new weights
      const scoreAfter = (
        await evalFn(opts.adaptorDir, {
          modelPath: opts.modelPath,
          adaptorPath: weightsDir,
          dryRun: opts.dryRun,
        })
      ).meanComposite;

      const committed = scoreAfter >= scoreBefore;

      if (committed) {
        // Keep new weights; remove backup
        if (existsSync(backupFile)) unlinkSync(backupFile);
      } else {
        // Restore previous weights from backup
        if (existsSync(backupFile)) {
          copyFileSync(backupFile, checkpointFile);
          unlinkSync(backupFile);
        }
      }

      currentScore = committed ? scoreAfter : scoreBefore;
      results.push({
        round,
        generated: samples.length,
        filtered: filtered.length,
        scoreBefore,
        scoreAfter,
        committed,
      });
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  }

  return results;
}
