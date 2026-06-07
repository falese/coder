import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runMlxBuffered } from "../inference/mlx-runner.js";
import { parseThreads } from "../episodes/threads.js";
import type { EvalSummary, EvalRecord } from "./runner.js";

/**
 * Persona/voice verifier: thread-recall.
 *
 * "Did the LoRA learn the user's voice?" is measured structurally — generate an
 * answer for a held-out prompt, parse its concept `<threads>`, and compare to
 * the episode's reference threads. Local, deterministic, no embeddings (the
 * embedding scorer stays dropped from v1 per docs/spec.md). This same metric is
 * the in-loop SSD verifier (via `scoreThreadRecall`) and the eval (`runPersonaEval`).
 */
export interface ThreadRecall {
  precision: number;
  recall: number;
  f1: number;
}

function normSet(threads: string[]): Set<string> {
  return new Set(
    threads.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0),
  );
}

export function threadRecall(predicted: string[], reference: string[]): ThreadRecall {
  const pred = normSet(predicted);
  const ref = normSet(reference);
  let inter = 0;
  for (const r of ref) if (pred.has(r)) inter += 1;
  const precision = pred.size === 0 ? 0 : inter / pred.size;
  const recall = ref.size === 0 ? 0 : inter / ref.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

/**
 * Per-sample scorer for the SSD loop: F1 of a completion's `<threads>` against
 * the prompt's reference threads. Plugs into `sampleCompletions`' `scoreSample`.
 */
export function scoreThreadRecall(
  refs: Map<string, string[]>,
): (prompt: string, completion: string) => number {
  return (prompt, completion) =>
    threadRecall(parseThreads(completion), refs.get(prompt) ?? []).f1;
}

export interface PersonaEvalRecord {
  prompt: string;
  predicted: string[];
  reference: string[];
  precision: number;
  recall: number;
  f1: number;
}

export interface PersonaEvalSummary {
  records: PersonaEvalRecord[];
  meanPrecision: number;
  meanRecall: number;
  meanF1: number;
}

export interface PersonaEvalOptions {
  modelPath: string;
  adaptorPath?: string;
  inputFile?: string;
  dryRun: boolean;
}

interface PersonaRef {
  prompt: string;
  threads: string[];
}

function loadPersonaRefs(file: string): PersonaRef[] {
  if (!existsSync(file)) return [];
  const content = readFileSync(file, "utf-8").trim();
  if (!content) return [];
  return content
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as PersonaRef);
}

/**
 * Load the in-loop persona sampling pool (`data/persona-pool.jsonl`): the prompt
 * list to sample from and a prompt→reference-threads map for scoring.
 */
export function loadPersonaPool(adaptorDir: string): { prompts: string[]; refs: Map<string, string[]> } {
  const records = loadPersonaRefs(join(adaptorDir, "data", "persona-pool.jsonl"));
  const refs = new Map<string, string[]>();
  for (const r of records) refs.set(r.prompt, r.threads);
  return { prompts: records.map((r) => r.prompt), refs };
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function summarize(records: PersonaEvalRecord[]): PersonaEvalSummary {
  return {
    records,
    meanPrecision: mean(records.map((r) => r.precision)),
    meanRecall: mean(records.map((r) => r.recall)),
    meanF1: mean(records.map((r) => r.f1)),
  };
}

/**
 * Run the persona eval over `data/persona-eval.jsonl` ({prompt, threads}).
 * Generates an answer per prompt, parses its threads, scores thread-recall.
 * Dry-run returns a deterministic 0.5 stub (mirrors `runEval`).
 */
export async function runPersonaEval(
  adaptorDir: string,
  opts: PersonaEvalOptions,
): Promise<PersonaEvalSummary> {
  const inputFile = opts.inputFile ?? join(adaptorDir, "data", "persona-eval.jsonl");
  const refs = loadPersonaRefs(inputFile);

  if (opts.dryRun) {
    return summarize(
      refs.map((r) => ({
        prompt: r.prompt,
        predicted: [],
        reference: r.threads,
        precision: 0.5,
        recall: 0.5,
        f1: 0.5,
      })),
    );
  }

  const records: PersonaEvalRecord[] = [];
  for (const ref of refs) {
    const { generatedText } = await runMlxBuffered({
      model: opts.modelPath,
      adaptor: opts.adaptorPath,
      prompt: ref.prompt,
    });
    const predicted = parseThreads(generatedText);
    const tr = threadRecall(predicted, ref.threads);
    records.push({ prompt: ref.prompt, predicted, reference: ref.threads, ...tr });
  }
  return summarize(records);
}

/**
 * Adapt a persona summary to the `EvalSummary` shape so it drops into
 * `runSelfImprove`'s `evalFn` slot (F1 → the composite dimension).
 */
export function toEvalSummary(summary: PersonaEvalSummary): EvalSummary {
  const records: EvalRecord[] = summary.records.map((r) => ({
    prompt: r.prompt,
    scores: { tsc: r.f1, eslint: r.f1, tests: r.f1 },
    composite: r.f1,
    generatedCode: r.predicted.join(", "),
    diagnostics: { tsc: "", eslint: "", tests: "" },
  }));
  return {
    records,
    meanTsc: summary.meanF1,
    meanEslint: summary.meanF1,
    meanTests: summary.meanF1,
    meanComposite: summary.meanF1,
  };
}

export function formatPersonaTable(summary: PersonaEvalSummary): string {
  const col = { prompt: 50, prec: 11, rec: 9, f1: 7 };
  const header =
    "PROMPT".padEnd(col.prompt) +
    "PRECISION".padEnd(col.prec) +
    "RECALL".padEnd(col.rec) +
    "F1";
  const divider = "-".repeat(col.prompt + col.prec + col.rec + col.f1);
  const rows = summary.records.map((r) => {
    const last = r.prompt.split("\n").filter((l) => l.trim()).at(-1) ?? r.prompt;
    const p = last.length > 48 ? last.slice(0, 48) : last;
    return (
      p.padEnd(col.prompt) +
      r.precision.toFixed(2).padEnd(col.prec) +
      r.recall.toFixed(2).padEnd(col.rec) +
      r.f1.toFixed(3)
    );
  });
  const meanRow =
    "MEAN".padEnd(col.prompt) +
    summary.meanPrecision.toFixed(2).padEnd(col.prec) +
    summary.meanRecall.toFixed(2).padEnd(col.rec) +
    summary.meanF1.toFixed(3);
  return [header, divider, ...rows, divider, meanRow].join("\n");
}
