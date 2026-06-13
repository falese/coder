import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMlxBuffered } from "./mlx-runner.js";
import {
  cleanGeneratedOutput,
  runTscCheck,
  runEslintCheck,
  runTestsCheck,
  computeComposite,
} from "../eval/runner.js";
import type { GenerateOptions } from "./types.js";

export interface SampleResult {
  prompt: string;
  completion: string;
  composite: number;
}

/**
 * Pluggable verifier for the SSD loop. When supplied, completions are scored by
 * `scoreSample` (e.g. persona thread-recall) instead of the code composite, and
 * `prepareCompletion` may transform the stored completion (e.g. `stripThreads`
 * for voice-only training). Omitted → the default tsc/eslint/tests verifier.
 */
export interface SampleVerifier {
  scoreSample: (prompt: string, completion: string) => number | Promise<number>;
  prepareCompletion?: (completion: string) => string;
}

/**
 * Generate k completions for each prompt at the given temperature, score each,
 * and return all results. The caller filters by composite threshold.
 *
 * Completions are generated sequentially (never concurrently) to respect the
 * 18 GB unified-memory constraint. The default verifier scores each completion
 * through the code eval harness (scorers run in parallel); a supplied
 * `verifier` overrides that (and skips adaptor scoring-asset resolution).
 */
export async function sampleCompletions(
  prompts: string[],
  k: number,
  temperature: number,
  opts: Pick<GenerateOptions, "model" | "adaptor">,
  evalOpts: { adaptorDir: string },
  verifier?: SampleVerifier,
): Promise<SampleResult[]> {
  if (prompts.length === 0) return [];

  if (process.env.CODER_DRY_RUN === "1") {
    return prompts.flatMap((prompt) =>
      Array.from({ length: k }, () => ({
        prompt,
        completion: `// dry-run: ${prompt}`,
        composite: 0.5,
      })),
    );
  }

  // Pluggable-verifier path (e.g. persona thread-recall) — no code-asset resolution.
  if (verifier) {
    const results: SampleResult[] = [];
    for (const prompt of prompts) {
      for (let i = 0; i < k; i++) {
        const { generatedText } = await runMlxBuffered({
          model: opts.model,
          adaptor: opts.adaptor,
          prompt,
          temperature,
        });
        const cleaned = cleanGeneratedOutput(generatedText);
        const estimatedTokens = (prompt.length + cleaned.length) / 4;
        if (estimatedTokens > 2048) continue;
        // scoreSample may be sync or async — normalize to a Promise to await safely.
        const composite = await Promise.resolve(verifier.scoreSample(prompt, cleaned));
        const completion = verifier.prepareCompletion ? verifier.prepareCompletion(cleaned) : cleaned;
        results.push({ prompt, completion, composite });
      }
    }
    return results;
  }

  const { adaptorDir } = evalOpts;

  // Resolve optional adaptor-supplied scoring assets (same logic as runEval)
  const eslintConfigMjs = join(adaptorDir, "evals", "eslint.config.mjs");
  const eslintConfigJs = join(adaptorDir, "evals", "eslint.config.js");
  const eslintConfigPath = existsSync(eslintConfigMjs)
    ? eslintConfigMjs
    : existsSync(eslintConfigJs)
      ? eslintConfigJs
      : undefined;

  const declarationsFile = join(adaptorDir, "evals", "declarations.d.ts");
  const declarationsPath = existsSync(declarationsFile) ? declarationsFile : undefined;

  const evalSuiteFile = join(adaptorDir, "evals", "eval_suite.ts");
  const hasEvalSuite = existsSync(evalSuiteFile);

  const results: SampleResult[] = [];

  for (const prompt of prompts) {
    for (let i = 0; i < k; i++) {
      const { generatedText } = await runMlxBuffered({
        model: opts.model,
        adaptor: opts.adaptor,
        prompt,
        temperature,
      });

      const completion = cleanGeneratedOutput(generatedText);

      // Skip samples that would exceed mlx_lm's 2048-token training limit.
      // ~4 chars per token is a conservative heuristic for code.
      const estimatedTokens = (prompt.length + completion.length) / 4;
      if (estimatedTokens > 2048) continue;

      const tempFile = join(tmpdir(), `coder-sample-${String(Date.now())}.tsx`);
      writeFileSync(tempFile, prompt + "\n" + completion);

      const [tscResult, eslintResult, testsResult] = await Promise.all([
        runTscCheck(tempFile, declarationsPath),
        runEslintCheck(tempFile, eslintConfigPath),
        hasEvalSuite
          ? runTestsCheck(evalSuiteFile, tempFile)
          : Promise.resolve({ pass: false, output: "no eval suite found" }),
      ]);

      try { unlinkSync(tempFile); } catch { /* best-effort */ }

      const scores = {
        tsc: tscResult.pass ? 1 : 0,
        eslint: eslintResult.pass ? 1 : 0,
        tests: testsResult.pass ? 1 : 0,
      };

      results.push({ prompt, completion, composite: computeComposite(scores) });
    }
  }

  return results;
}
