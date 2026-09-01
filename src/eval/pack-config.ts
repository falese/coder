import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Per-pack eval configuration (`<adaptor>/evals/eval.config.json`).
 *
 * The default composite — `tsc*0.4 + eslint*0.3 + tests*0.3` — assumes the
 * adaptor emits TypeScript source. An adaptor whose target artifact is not
 * TypeScript (the `intent-manifest` pack emits a YAML `mfe-manifest.yaml`)
 * needs three things the default cannot express: tsc/eslint carry no signal and
 * must not dilute the score, the artifact is not a `.tsx` file and the prompt
 * (a prose intent) must not be prepended to it, and generation needs the pack's
 * grammar system prompt. The file is optional; when absent every field falls
 * back to the historic behaviour, so existing packs are untouched.
 */

export const DEFAULT_EVAL_WEIGHTS = { tsc: 0.4, eslint: 0.3, tests: 0.3 } as const;

const WeightsSchema = z
  .object({
    tsc: z.number().min(0),
    eslint: z.number().min(0),
    tests: z.number().min(0),
  })
  .refine((w) => w.tsc + w.eslint + w.tests > 0, {
    message: "at least one eval dimension must carry a non-zero weight",
  });

const ArtifactSchema = z.object({
  /** File extension for the temp file handed to the scorers. */
  extension: z.string().min(1).default(".tsx"),
  /** Prepend the eval prompt to the generated text (code-context packs). */
  includePrompt: z.boolean().default(true),
});

export const EvalPackConfigSchema = z.object({
  weights: WeightsSchema.default(DEFAULT_EVAL_WEIGHTS),
  artifact: ArtifactSchema.default({ extension: ".tsx", includePrompt: true }),
  /** Pack-relative path to a system prompt passed to the model at eval time. */
  systemPrompt: z.string().min(1).optional(),
  /** Generation cap for eval runs; falls back to the mlx-runner default. */
  maxTokens: z.number().int().positive().optional(),
});

export type EvalPackConfig = z.infer<typeof EvalPackConfigSchema>;
export type EvalWeights = EvalPackConfig["weights"];
export type EvalArtifactConfig = EvalPackConfig["artifact"];

export function loadEvalPackConfig(adaptorDir: string): EvalPackConfig {
  const configPath = join(adaptorDir, "evals", "eval.config.json");
  if (!existsSync(configPath)) return EvalPackConfigSchema.parse({});

  const raw = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
  return EvalPackConfigSchema.parse(raw);
}

/** Compose the text scored by tsc/eslint/the eval suite for one record. */
export function buildEvalArtifact(
  prompt: string,
  generated: string,
  artifact: EvalArtifactConfig,
): string {
  return artifact.includePrompt ? prompt + "\n" + generated : generated;
}

/** Resolve a pack-relative system prompt path; a declared file must exist. */
export function resolveSystemPrompt(
  adaptorDir: string,
  systemPrompt: string | undefined,
): string | undefined {
  if (systemPrompt === undefined) return undefined;
  const resolved = join(adaptorDir, systemPrompt);
  if (!existsSync(resolved)) {
    throw new Error(`Declared system prompt not found: ${resolved}`);
  }
  return resolved;
}
