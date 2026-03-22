import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMlxBuffered, checkPreflight } from "../inference/mlx-runner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DimensionScores {
  tsc: number;
  eslint: number;
  tests: number;
}

export interface EvalRecord {
  prompt: string;
  scores: DimensionScores;
  composite: number;
}

export interface EvalSummary {
  records: EvalRecord[];
  meanTsc: number;
  meanEslint: number;
  meanTests: number;
  meanComposite: number;
}

export interface EvalOptions {
  modelPath: string;
  inputFile?: string;
  dryRun: boolean;
}

interface JsonlRecord {
  prompt: string;
  completion: string;
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

export function computeComposite(scores: DimensionScores): number {
  return scores.tsc * 0.4 + scores.eslint * 0.3 + scores.tests * 0.3;
}

export function formatEvalTable(summary: EvalSummary): string {
  const col = {
    prompt: 42,
    tsc: 6,
    eslint: 8,
    tests: 7,
    composite: 10,
  };

  const header =
    "PROMPT".padEnd(col.prompt) +
    "TSC".padEnd(col.tsc) +
    "ESLINT".padEnd(col.eslint) +
    "TESTS".padEnd(col.tests) +
    "COMPOSITE";

  const divider = "-".repeat(
    col.prompt + col.tsc + col.eslint + col.tests + col.composite,
  );

  const rows = summary.records.map((rec) => {
    const prompt =
      rec.prompt.length > 40
        ? rec.prompt.slice(0, 40)
        : rec.prompt;
    return (
      prompt.padEnd(col.prompt) +
      rec.scores.tsc.toFixed(1).padEnd(col.tsc) +
      rec.scores.eslint.toFixed(1).padEnd(col.eslint) +
      rec.scores.tests.toFixed(1).padEnd(col.tests) +
      rec.composite.toFixed(3)
    );
  });

  const meanRow =
    "MEAN".padEnd(col.prompt) +
    summary.meanTsc.toFixed(1).padEnd(col.tsc) +
    summary.meanEslint.toFixed(1).padEnd(col.eslint) +
    summary.meanTests.toFixed(1).padEnd(col.tests) +
    summary.meanComposite.toFixed(3);

  return [header, divider, ...rows, divider, meanRow].join("\n");
}

// ---------------------------------------------------------------------------
// Scorer functions
// ---------------------------------------------------------------------------

export async function runTscCheck(filePath: string): Promise<boolean> {
  const proc = Bun.spawn(
    ["bunx", "tsc", "--noEmit", "--allowJs", "--checkJs", "--strict", filePath],
    { stdout: "ignore", stderr: "ignore" },
  );
  const exitCode = await proc.exited;
  return exitCode === 0;
}

export async function runEslintCheck(
  filePath: string,
  eslintConfig?: string,
): Promise<boolean> {
  const args = ["bunx", "eslint", filePath];
  if (eslintConfig !== undefined) {
    args.push("--config", eslintConfig);
  }
  const proc = Bun.spawn(args, { stdout: "ignore", stderr: "ignore" });
  const exitCode = await proc.exited;
  return exitCode === 0;
}

export async function runTestsCheck(
  evalSuiteFile: string,
  generatedFilePath: string,
): Promise<boolean> {
  const proc = Bun.spawn(["bun", "test", evalSuiteFile], {
    stdout: "ignore",
    stderr: "ignore",
    env: { ...process.env, CODER_EVAL_OUTPUT: generatedFilePath },
  });
  const exitCode = await proc.exited;
  return exitCode === 0;
}

// ---------------------------------------------------------------------------
// Manifest update
// ---------------------------------------------------------------------------

export function updateManifestScore(
  manifestPath: string,
  score: number,
  isBaseline: boolean,
): void {
  if (!existsSync(manifestPath)) return;
  const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<
    string,
    unknown
  >;
  if (isBaseline) {
    raw.baseline_pass_rate = score;
  } else {
    raw.eval_pass_rate = score;
  }
  writeFileSync(manifestPath, JSON.stringify(raw, null, 2));
}

// ---------------------------------------------------------------------------
// Load eval JSONL
// ---------------------------------------------------------------------------

function loadEvalRecords(filePath: string): JsonlRecord[] {
  if (!existsSync(filePath)) {
    throw new Error(`Eval JSONL not found: ${filePath}`);
  }
  const content = readFileSync(filePath, "utf-8").trim();
  if (!content) return [];
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JsonlRecord);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runEval(
  adaptorDir: string,
  opts: EvalOptions,
): Promise<EvalSummary> {
  const inputFile =
    opts.inputFile ?? join(adaptorDir, "data", "eval.jsonl");
  const records = loadEvalRecords(inputFile);

  if (opts.dryRun) {
    const dryRecords: EvalRecord[] = records.map((r) => ({
      prompt: r.prompt,
      scores: { tsc: 0.5, eslint: 0.5, tests: 0.5 },
      composite: 0.5,
    }));
    return {
      records: dryRecords,
      meanTsc: records.length === 0 ? 0 : 0.5,
      meanEslint: records.length === 0 ? 0 : 0.5,
      meanTests: records.length === 0 ? 0 : 0.5,
      meanComposite: records.length === 0 ? 0 : 0.5,
    };
  }

  await checkPreflight();

  const eslintConfig = join(adaptorDir, "evals", ".eslintrc.json");
  const eslintConfigPath = existsSync(eslintConfig)
    ? eslintConfig
    : undefined;
  const evalSuiteFile = join(adaptorDir, "evals", "eval_suite.ts");

  const evalRecords: EvalRecord[] = [];

  for (const record of records) {
    const { generatedText } = await runMlxBuffered({
      model: opts.modelPath,
      prompt: record.prompt,
    });

    const tempFile = join(
      tmpdir(),
      `coder-eval-${String(Date.now())}.ts`,
    );
    writeFileSync(tempFile, generatedText);

    const [tscPass, eslintPass, testsPass] = await Promise.all([
      runTscCheck(tempFile),
      runEslintCheck(tempFile, eslintConfigPath),
      existsSync(evalSuiteFile)
        ? runTestsCheck(evalSuiteFile, tempFile)
        : Promise.resolve(false),
    ]);

    // clean up temp file
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(tempFile);
    } catch {
      // best-effort
    }

    const scores: DimensionScores = {
      tsc: tscPass ? 1 : 0,
      eslint: eslintPass ? 1 : 0,
      tests: testsPass ? 1 : 0,
    };

    evalRecords.push({
      prompt: record.prompt,
      scores,
      composite: computeComposite(scores),
    });
  }

  return {
    records: evalRecords,
    meanTsc: mean(evalRecords.map((r) => r.scores.tsc)),
    meanEslint: mean(evalRecords.map((r) => r.scores.eslint)),
    meanTests: mean(evalRecords.map((r) => r.scores.tests)),
    meanComposite: mean(evalRecords.map((r) => r.composite)),
  };
}
