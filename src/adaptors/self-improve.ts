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
import { logger } from "../observability/logger.js";
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

  // Establish baseline score before round 1; capture per-prompt composites for adaptive temp
  const baselineSummary = await evalFn(opts.adaptorDir, {
    modelPath: opts.modelPath,
    adaptorPath: weightsDir,
    dryRun: opts.dryRun,
  });
  let currentScore = baselineSummary.meanComposite;
  let perPromptComposites = new Map(
    baselineSummary.records.map((r) => [r.prompt, r.composite]),
  );

  // Resolve temperature for a prompt given the adaptive schedule
  function resolveTemp(prompt: string): number {
    if (opts.temperature !== "adaptive") return opts.temperature;
    const c = perPromptComposites.get(prompt) ?? 0.7;
    if (c >= 0.9) return 0.3;
    if (c >= 0.5) return 0.7;
    return 1.0;
  }

  const baselineScore = currentScore;
  const results: RoundResult[] = [];

  for (let round = 1; round <= opts.rounds; round++) {
    const scoreBefore = currentScore;

    logger.logEvent({
      event: "self_improve_round_start",
      ts: new Date().toISOString(),
      round,
      total_rounds: opts.rounds,
      adaptor: opts.adaptorDir,
    });

    // Group prompts by resolved temperature; sample each group
    const groups = new Map<number, string[]>();
    for (const p of prompts) {
      const t = resolveTemp(p);
      const g = groups.get(t) ?? [];
      g.push(p);
      groups.set(t, g);
    }

    const allSamples: SampleResult[] = [];
    for (const [groupTemp, groupPrompts] of groups) {
      const s = await sampleFn(
        groupPrompts,
        opts.samplesPerPrompt,
        groupTemp,
        { model: opts.modelPath, adaptor: weightsDir },
        { adaptorDir: opts.adaptorDir },
      );
      allSamples.push(...s);
    }

    // Filter by threshold
    const filtered = allSamples.filter((s) => s.composite >= opts.threshold);

    logger.logEvent({
      event: "self_improve_sample",
      ts: new Date().toISOString(),
      round,
      generated: allSamples.length,
      passed: filtered.length,
      top_composite: allSamples.reduce((max, s) => Math.max(max, s.composite), 0),
    });

    if (filtered.length === 0) {
      logger.logEvent({
        event: "self_improve_round_end",
        ts: new Date().toISOString(),
        round,
        score_before: scoreBefore,
        score_after: scoreBefore,
        delta: 0,
        committed: false,
      });
      results.push({
        round,
        generated: allSamples.length,
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
      const postSummary = await evalFn(opts.adaptorDir, {
        modelPath: opts.modelPath,
        adaptorPath: weightsDir,
        dryRun: opts.dryRun,
      });
      const scoreAfter = postSummary.meanComposite;

      const committed = scoreAfter >= scoreBefore;

      if (committed) {
        // Keep new weights; remove backup; update per-prompt composites for next round
        if (existsSync(backupFile)) unlinkSync(backupFile);
        perPromptComposites = new Map(
          postSummary.records.map((r) => [r.prompt, r.composite]),
        );
      } else {
        // Restore previous weights from backup
        if (existsSync(backupFile)) {
          copyFileSync(backupFile, checkpointFile);
          unlinkSync(backupFile);
        }
      }

      currentScore = committed ? scoreAfter : scoreBefore;

      logger.logEvent({
        event: "self_improve_round_end",
        ts: new Date().toISOString(),
        round,
        score_before: scoreBefore,
        score_after: scoreAfter,
        delta: scoreAfter - scoreBefore,
        committed,
      });

      results.push({
        round,
        generated: allSamples.length,
        filtered: filtered.length,
        scoreBefore,
        scoreAfter,
        committed,
      });
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  }

  // Write manifest history fields
  const manifestPath = join(opts.adaptorDir, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    manifest.self_improve_rounds = results.filter((r) => r.committed).length;
    manifest.self_improve_score_history = [
      baselineScore,
      ...results.map((r) => r.scoreAfter),
    ];
    manifest.self_improve_last_run = new Date().toISOString();
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }

  const roundsCommitted = results.filter((r) => r.committed).length;
  logger.logEvent({
    event: "self_improve_complete",
    ts: new Date().toISOString(),
    rounds_committed: roundsCommitted,
    rounds_total: opts.rounds,
    final_score: results.at(-1)?.scoreAfter ?? 0,
  });

  return results;
}
