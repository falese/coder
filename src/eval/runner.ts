import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
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
  adaptorPath?: string;
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

export function cleanGeneratedOutput(raw: string): string {
  // If output starts with a fenced code block, extract its contents
  const fencedMatch = /^```[^\n]*\n([\s\S]*?)```/.exec(raw);
  if (fencedMatch) return fencedMatch[1].trimEnd();

  // Otherwise truncate at the first closing fence or chat end token
  const cutMatch = /^([\s\S]*?)(?:^```|<\|im_end\|>)/m.exec(raw);
  if (cutMatch) return cutMatch[1].trimEnd();

  return raw.trimEnd();
}

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
  const checkDir = join(tmpdir(), `coder-tsc-${String(Date.now())}`);
  mkdirSync(checkDir, { recursive: true });

  const ext = filePath.endsWith(".tsx") ? ".tsx" : ".ts";
  const checkFile = join(checkDir, `check${ext}`);

  // Replace import statements with any declarations so module resolution
  // doesn't fail, while still checking the actual code for type errors
  const source = readFileSync(filePath, "utf-8");
  const transformed = source
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith("import ")) return line;
      // default import: import Foo from 'bar'  → declare const Foo: any;
      const defaultMatch = /^import\s+(\w+)\s+from\s+['"]/.exec(trimmed);
      if (defaultMatch) return `declare const ${defaultMatch[1]}: any;`;
      // named imports: import { A, B } from 'bar' → declare const A: any; declare const B: any;
      const namedMatch = /^import\s*\{([^}]+)\}\s+from\s+['"]/.exec(trimmed);
      if (namedMatch) {
        return namedMatch[1]
          .split(",")
          .map((n) => `declare const ${n.trim().split(" as ")[0].trim()}: any;`)
          .join(" ");
      }
      // namespace import: import * as Foo from 'bar' → declare const Foo: any;
      const nsMatch = /^import\s*\*\s+as\s+(\w+)\s+from\s+['"]/.exec(trimmed);
      if (nsMatch) return `declare const ${nsMatch[1]}: any;`;
      // side-effect import: import 'foo' → (remove)
      return "";
    })
    .join("\n");
  writeFileSync(checkFile, transformed);

  // Shim common React types so annotations like React.FC<P> work
  writeFileSync(
    join(checkDir, "declarations.d.ts"),
    [
      "declare namespace React {",
      "  type FC<P = {}> = (props: P) => any;",
      "  type ReactNode = any;",
      "  function createElement(...args: any[]): any;",
      "}",
    ].join("\n") + "\n",
  );

  writeFileSync(
    join(checkDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: false,
        noImplicitAny: false,
        jsx: "react",
        skipLibCheck: true,
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        moduleResolution: "node",
        target: "ES2020",
      },
      include: ["*.ts", "*.tsx"],
    }),
  );

  const proc = Bun.spawn(
    ["bunx", "tsc", "--project", join(checkDir, "tsconfig.json")],
    { stdout: "ignore", stderr: "ignore" },
  );
  const exitCode = await proc.exited;

  try { rmSync(checkDir, { recursive: true }); } catch { /* best-effort */ }

  return exitCode === 0;
}

export async function runEslintCheck(
  filePath: string,
  eslintConfig?: string,
): Promise<boolean> {
  // ESLint v9 flat config treats files outside the project root as ignored.
  // Copy the file into a project-local temp dir so the base path includes it.
  const projectRoot = process.cwd();
  const lintDir = join(projectRoot, ".coder-eval-tmp");
  mkdirSync(lintDir, { recursive: true });
  const lintFile = join(lintDir, `eval-${String(Date.now())}.ts`);
  writeFileSync(lintFile, readFileSync(filePath, "utf-8"));

  // Write a minimal eval ESLint config if no adaptor config provided.
  // Uses project node_modules so typescript-eslint is resolvable.
  const evalEslintConfig = join(lintDir, "eslint.config.mjs");
  if (!existsSync(evalEslintConfig)) {
    writeFileSync(
      evalEslintConfig,
      [
        'import tseslint from "typescript-eslint";',
        "export default tseslint.config(",
        "  ...tseslint.configs.recommended,",
        ");",
      ].join("\n") + "\n",
    );
  }

  const args = ["bunx", "eslint", "--no-warn-ignored", "--config",
    eslintConfig ?? evalEslintConfig,
  ];
  args.push(lintFile);

  const proc = Bun.spawn(args, {
    stdout: "ignore",
    stderr: "ignore",
    cwd: projectRoot,
  });
  const exitCode = await proc.exited;

  try { rmSync(lintFile); } catch { /* best-effort */ }

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
      adaptor: opts.adaptorPath,
    });

    const tempFile = join(
      tmpdir(),
      `coder-eval-${String(Date.now())}.ts`,
    );
    writeFileSync(tempFile, cleanGeneratedOutput(generatedText));

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
