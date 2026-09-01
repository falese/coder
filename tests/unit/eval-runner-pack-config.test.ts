import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runEval,
  computeComposite,
  formatEvalTable,
  formatEvalReport,
} from "../../src/eval/runner.js";
import { markPreflightDoneForTest } from "../../src/inference/mlx-runner.js";
import type { EvalSummary } from "../../src/eval/runner.js";

let tempDir: string;
/** argv of every `python3 -m mlx_lm generate` spawn the run made. */
let mlxCalls: string[][];
let spawnSpy: ReturnType<typeof spyOn<typeof Bun, "spawn">> | undefined;

const GENERATED = "```yaml\nname: cart\nversion: 1.0.0\n```";

function stubStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      if (text) controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

/**
 * Intercept only the mlx generation subprocess; the scorers (bunx tsc, bunx
 * eslint, bun test) still really run, so what they are handed is under test.
 */
function stubMlxSpawn(): void {
  const realSpawn = Bun.spawn.bind(Bun);
  spawnSpy = spyOn(Bun, "spawn").mockImplementation(((...args: unknown[]) => {
    const argv = args[0] as string[];
    if (argv[0] === "python3" && argv.includes("generate")) {
      mlxCalls.push(argv);
      return {
        stdout: stubStream(`==========\n${GENERATED}\n==========\n`),
        stderr: stubStream(""),
        exited: Promise.resolve(0),
      };
    }
    return realSpawn(...(args as Parameters<typeof Bun.spawn>));
  }) as typeof Bun.spawn);
}

beforeEach(() => {
  mlxCalls = [];
  tempDir = mkdtempSync(join(tmpdir(), "coder-eval-pack-"));
  markPreflightDoneForTest();
});

afterEach(() => {
  spawnSpy?.mockRestore();
  spawnSpy = undefined;
  rmSync(tempDir, { recursive: true, force: true });
});

/**
 * A YAML-target adaptor pack: the eval suite is the only weighted dimension,
 * the artifact is a `.yaml` file, and the prose prompt is not prepended to it.
 */
function writeYamlPack(): void {
  mkdirSync(join(tempDir, "evals"), { recursive: true });
  mkdirSync(join(tempDir, "prompts"), { recursive: true });
  mkdirSync(join(tempDir, "data"), { recursive: true });

  writeFileSync(
    join(tempDir, "evals", "eval.config.json"),
    JSON.stringify({
      weights: { tsc: 0, eslint: 0, tests: 1 },
      artifact: { extension: ".yaml", includePrompt: false },
      systemPrompt: "prompts/system.md",
      maxTokens: 900,
    }),
  );
  writeFileSync(join(tempDir, "prompts", "system.md"), "Emit only YAML.\n");
  // The suite asserts the artifact it is handed: bare YAML, .yaml extension.
  writeFileSync(
    join(tempDir, "evals", "eval_suite.ts"),
    [
      `import { test, expect } from "bun:test";`,
      `import { readFileSync } from "node:fs";`,
      `const path = process.env.CODER_EVAL_OUTPUT as string;`,
      `test("artifact is bare yaml", () => {`,
      `  expect(path.endsWith(".yaml")).toBe(true);`,
      `  expect(readFileSync(path, "utf-8")).toBe("name: cart\\nversion: 1.0.0");`,
      `});`,
    ].join("\n") + "\n",
  );
  writeFileSync(
    join(tempDir, "data", "eval.jsonl"),
    JSON.stringify({ prompt: "A cart MFE", completion: "name: cart\n" }) + "\n",
  );
}

describe("computeComposite — pack weights", () => {
  test("defaults to the tsc/eslint/tests 0.4/0.3/0.3 split", () => {
    expect(computeComposite({ tsc: 1, eslint: 0, tests: 1 })).toBeCloseTo(0.7);
  });

  test("renormalises over the weighted dimensions", () => {
    const weights = { tsc: 0, eslint: 0, tests: 1 };
    expect(computeComposite({ tsc: 0, eslint: 0, tests: 1 }, weights)).toBeCloseTo(1);
    expect(computeComposite({ tsc: 1, eslint: 1, tests: 0 }, weights)).toBeCloseTo(0);
  });

  test("weights need not sum to one", () => {
    const weights = { tsc: 1, eslint: 1, tests: 2 };
    expect(computeComposite({ tsc: 1, eslint: 0, tests: 1 }, weights)).toBeCloseTo(0.75);
  });
});

describe("runEval — YAML-target pack config", () => {
  test("scores the eval suite alone and hands it the bare generated YAML", async () => {
    writeYamlPack();
    stubMlxSpawn();

    const summary = await runEval(tempDir, { modelPath: "/any/model", dryRun: false });

    expect(summary.records).toHaveLength(1);
    // The eval suite passed, so the tests-only composite is 1.
    expect(summary.records[0].scores.tests).toBe(1);
    expect(summary.records[0].composite).toBeCloseTo(1);
    expect(summary.meanComposite).toBeCloseTo(1);
    // Zero-weight dimensions are not run — no tsc/eslint spawn, no false signal.
    expect(summary.records[0].diagnostics.tsc).toBe("");
    expect(summary.records[0].diagnostics.eslint).toBe("");
    expect(summary.weights).toEqual({ tsc: 0, eslint: 0, tests: 1 });
  });

  test("passes the pack system prompt and maxTokens to generation", async () => {
    writeYamlPack();
    stubMlxSpawn();

    await runEval(tempDir, { modelPath: "/any/model", dryRun: false });

    expect(mlxCalls).toHaveLength(1);
    const argv = mlxCalls[0];
    expect(argv[argv.indexOf("--system-prompt") + 1]).toBe("Emit only YAML.");
    expect(argv[argv.indexOf("--max-tokens") + 1]).toBe("900");
  });
});

// ---------------------------------------------------------------------------
// Formatters — zero-weight dimensions must not read as failures
// ---------------------------------------------------------------------------

describe("formatEvalTable / formatEvalReport — zero-weight dimensions", () => {
  const summary: EvalSummary = {
    records: [
      {
        prompt: "A cart MFE",
        scores: { tsc: 0, eslint: 0, tests: 1 },
        composite: 1,
        generatedCode: "name: cart\n",
        diagnostics: { tsc: "", eslint: "", tests: "" },
      },
    ],
    meanTsc: 0,
    meanEslint: 0,
    meanTests: 1,
    meanComposite: 1,
    weights: { tsc: 0, eslint: 0, tests: 1 },
  };

  test("table prints n/a for unweighted dimensions", () => {
    const table = formatEvalTable(summary);

    expect(table).toContain("n/a");
    expect(table).not.toContain("0.0");
    expect(table).toContain("1.000");
  });

  test("report marks unweighted dimensions rather than scoring them", () => {
    const report = formatEvalReport(summary);

    expect(report).toContain("| TSC       | n/a");
    expect(report).toContain("**TSC n/a (unweighted)**");
    expect(report).toContain("**Tests 1.0 ✓**");
  });
});
