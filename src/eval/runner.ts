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

export interface DimensionDiagnostics {
  tsc: string;
  eslint: string;
  tests: string;
}

export interface EvalRecord {
  prompt: string;
  scores: DimensionScores;
  composite: number;
  generatedCode: string;
  diagnostics: DimensionDiagnostics;
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

interface ScorerResult {
  pass: boolean;
  output: string;
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

export function cleanGeneratedOutput(raw: string): string {
  // Extract the first fenced code block found anywhere in the output.
  // Chat models (baseline) often prefix code with prose — we want the code,
  // not the prose. This also handles the case where output starts with a fence.
  const fencedMatch = /```[^\n]*\n([\s\S]*?)```/.exec(raw);
  if (fencedMatch) return fencedMatch[1].trimEnd();

  // No fence: truncate at a chat end token if present
  const cutMatch = /^([\s\S]*?)<\|im_end\|>/m.exec(raw);
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
    // Use the last non-empty line (the jsdoc/comment/declaration anchor) for display
    // so multi-line prompts that start with import context don't break the table.
    const lastLine = rec.prompt.split("\n").filter((l) => l.trim()).at(-1) ?? rec.prompt;
    const prompt = lastLine.length > 40 ? lastLine.slice(0, 40) : lastLine;
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

export function formatEvalReport(summary: EvalSummary): string {
  const sections: string[] = [
    `# Eval Report`,
    ``,
    `| Dimension | Mean Score |`,
    `|-----------|------------|`,
    `| TSC       | ${summary.meanTsc.toFixed(3)}       |`,
    `| ESLint    | ${summary.meanEslint.toFixed(3)}       |`,
    `| Tests     | ${summary.meanTests.toFixed(3)}       |`,
    `| Composite | ${summary.meanComposite.toFixed(3)}       |`,
    ``,
  ];

  for (const rec of summary.records) {
    const tscIcon = rec.scores.tsc === 1 ? "✓" : "✗";
    const eslintIcon = rec.scores.eslint === 1 ? "✓" : "✗";
    const testsIcon = rec.scores.tests === 1 ? "✓" : "✗";

    sections.push(`---`);
    sections.push(``);
    sections.push(`## Prompt`);
    sections.push(``);
    sections.push(`\`\`\``);
    sections.push(rec.prompt);
    sections.push(`\`\`\``);
    sections.push(``);
    sections.push(`**Composite: ${rec.composite.toFixed(3)}**`);
    sections.push(``);
    sections.push(`### Generated code`);
    sections.push(``);
    sections.push(`\`\`\`typescript`);
    sections.push(rec.generatedCode || "(empty)");
    sections.push(`\`\`\``);
    sections.push(``);
    sections.push(`### Scores`);
    sections.push(``);
    sections.push(`**TSC ${rec.scores.tsc.toFixed(1)} ${tscIcon}**`);
    if (rec.diagnostics.tsc) {
      sections.push(`\`\`\``);
      sections.push(rec.diagnostics.tsc.trim());
      sections.push(`\`\`\``);
    }
    sections.push(``);
    sections.push(`**ESLint ${rec.scores.eslint.toFixed(1)} ${eslintIcon}**`);
    if (rec.diagnostics.eslint) {
      sections.push(`\`\`\``);
      sections.push(rec.diagnostics.eslint.trim());
      sections.push(`\`\`\``);
    }
    sections.push(``);
    sections.push(`**Tests ${rec.scores.tests.toFixed(1)} ${testsIcon}**`);
    if (rec.diagnostics.tests) {
      sections.push(`\`\`\``);
      sections.push(rec.diagnostics.tests.trim());
      sections.push(`\`\`\``);
    }
    sections.push(``);
  }

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Scorer functions
// ---------------------------------------------------------------------------

export async function runTscCheck(
  filePath: string,
  declarationsPath?: string,
): Promise<ScorerResult> {
  const checkDir = join(tmpdir(), `coder-tsc-${String(Date.now())}`);
  mkdirSync(checkDir, { recursive: true });

  const ext = filePath.endsWith(".tsx") ? ".tsx" : ".ts";
  const checkFile = join(checkDir, `check${ext}`);

  // Replace import statements with any declarations so module resolution
  // doesn't fail, while still checking the actual code for type errors
  const source = readFileSync(filePath, "utf-8");

  // Identifiers already declared in the declarations file — skip their default
  // imports to avoid redeclaration conflicts (e.g. 'declare namespace React'
  // would clash with a generated 'declare const React: any')
  const declarationsContent = declarationsPath
    ? readFileSync(declarationsPath, "utf-8")
    : "";
  const alreadyDeclared = new Set(
    [...declarationsContent.matchAll(
      /declare\s+(?:namespace|class|function|const|var|let|enum)\s+(\w+)/g,
    )].map((m) => m[1]),
  );

  const transformed = source
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith("import ")) return line;
      // Detect type-only imports before stripping the keyword — they must become
      // type aliases so names like ButtonProps can be used in type positions.
      const isTypeOnly = /^import\s+type\s+/.test(trimmed);
      const normalized = trimmed.replace(/^import\s+type\s+/, "import ");
      // default import: import Foo from 'bar'  → declare const Foo: any;
      // Skip if the declarations file already provides this identifier.
      const defaultMatch = /^import\s+(\w+)\s+from\s+['"]/.exec(normalized);
      if (defaultMatch) {
        if (alreadyDeclared.has(defaultMatch[1])) return "";
        return `declare const ${defaultMatch[1]}: any;`;
      }
      // named imports: import { A, B } from 'bar' → declare const A: any; ...
      // import type { A, B } from 'bar' → type A = any; ... (usable in type positions)
      const namedMatch = /^import\s*\{([^}]+)\}\s+from\s+['"]/.exec(normalized);
      if (namedMatch) {
        return namedMatch[1]
          .split(",")
          .map((n) => {
            // Use the local binding name (after 'as') so 'Button as MuiButton' → MuiButton
            const parts = n.trim().split(/\s+as\s+/);
            const localName = parts.length > 1 ? parts[1].trim() : parts[0].trim();
            return isTypeOnly ? `type ${localName} = any;` : `declare const ${localName}: any;`;
          })
          .join(" ");
      }
      // namespace import: import * as Foo from 'bar' → declare const Foo: any;
      const nsMatch = /^import\s*\*\s+as\s+(\w+)\s+from\s+['"]/.exec(normalized);
      if (nsMatch) return `declare const ${nsMatch[1]}: any;`;
      // side-effect import: import 'foo' → (remove)
      return "";
    })
    .join("\n");
  writeFileSync(checkFile, transformed);

  // Copy adaptor-supplied declarations if provided; otherwise write an empty file
  // so the tsconfig include glob always has something to pick up.
  writeFileSync(
    join(checkDir, "declarations.d.ts"),
    declarationsPath ? readFileSync(declarationsPath, "utf-8") : "",
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
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  try { rmSync(checkDir, { recursive: true }); } catch { /* best-effort */ }

  const output = (stdout + stderr).trim()
    .replace(/\/[^\s:]+coder-tsc-\d+\//g, "");  // strip temp dir paths
  return { pass: exitCode === 0, output };
}

export async function runEslintCheck(
  filePath: string,
  eslintConfig?: string,
): Promise<ScorerResult> {
  // ESLint v9 flat config treats files outside the project root as ignored.
  // Copy the file into a project-local temp dir so the base path includes it.
  const projectRoot = process.cwd();
  const lintDir = join(projectRoot, ".coder-eval-tmp");
  mkdirSync(lintDir, { recursive: true });
  // Use .tsx so ESLint's typescript-eslint parser handles JSX in completions
  const lintFile = join(lintDir, `eval-${String(Date.now())}.tsx`);
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
    stdout: "pipe",
    stderr: "pipe",
    cwd: projectRoot,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  try { rmSync(lintFile); } catch { /* best-effort */ }

  const output = (stdout + stderr).trim()
    .replace(/\S+coder-eval-tmp\/eval-\d+\.ts/g, "eval.ts");  // normalise temp path
  return { pass: exitCode === 0, output };
}

export async function runTestsCheck(
  evalSuiteFile: string,
  generatedFilePath: string,
): Promise<ScorerResult> {
  const proc = Bun.spawn(["bun", "test", evalSuiteFile], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CODER_EVAL_OUTPUT: generatedFilePath },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const output = (stdout + stderr).trim();
  return { pass: exitCode === 0, output };
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
      generatedCode: `# dry-run: ${r.prompt}`,
      diagnostics: { tsc: "", eslint: "", tests: "" },
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

  // Only flat config files (eslint.config.mjs / .js) are supported.
  // Legacy .eslintrc.json is not compatible with ESLint v9 --config flag.
  const eslintConfigMjs = join(adaptorDir, "evals", "eslint.config.mjs");
  const eslintConfigJs = join(adaptorDir, "evals", "eslint.config.js");
  const eslintConfigPath = existsSync(eslintConfigMjs)
    ? eslintConfigMjs
    : existsSync(eslintConfigJs)
      ? eslintConfigJs
      : undefined;

  // Adaptor-supplied type declarations for the isolated TSC check environment
  const declarationsFile = join(adaptorDir, "evals", "declarations.d.ts");
  const declarationsPath = existsSync(declarationsFile) ? declarationsFile : undefined;

  const evalSuiteFile = join(adaptorDir, "evals", "eval_suite.ts");

  const evalRecords: EvalRecord[] = [];

  for (const record of records) {
    const { generatedText } = await runMlxBuffered({
      model: opts.modelPath,
      prompt: record.prompt,
      adaptor: opts.adaptorPath,
    });

    const generatedCode = cleanGeneratedOutput(generatedText);

    // Use .tsx so tsc handles JSX syntax in React component completions.
    // Prepend the prompt (which includes import context) so TSC/ESLint see
    // the full module — only the completion is stored in the EvalRecord.
    const tempFile = join(
      tmpdir(),
      `coder-eval-${String(Date.now())}.tsx`,
    );
    writeFileSync(tempFile, record.prompt + "\n" + generatedCode);

    const [tscResult, eslintResult, testsResult] = await Promise.all([
      runTscCheck(tempFile, declarationsPath),
      runEslintCheck(tempFile, eslintConfigPath),
      existsSync(evalSuiteFile)
        ? runTestsCheck(evalSuiteFile, tempFile)
        : Promise.resolve<ScorerResult>({ pass: false, output: "no eval suite found" }),
    ]);

    // clean up temp file
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(tempFile);
    } catch {
      // best-effort
    }

    const scores: DimensionScores = {
      tsc: tscResult.pass ? 1 : 0,
      eslint: eslintResult.pass ? 1 : 0,
      tests: testsResult.pass ? 1 : 0,
    };

    evalRecords.push({
      prompt: record.prompt,
      scores,
      composite: computeComposite(scores),
      generatedCode,
      diagnostics: {
        tsc: tscResult.output,
        eslint: eslintResult.output,
        tests: testsResult.output,
      },
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
