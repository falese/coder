import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeComposite,
  formatEvalTable,
  formatEvalReport,
  runEval,
  updateManifestScore,
  runTscCheck,
  runEslintCheck,
  cleanGeneratedOutput,
} from "../../src/eval/runner.js";
import { markPreflightDoneForTest } from "../../src/inference/mlx-runner.js";
import type { EvalSummary } from "../../src/eval/runner.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-eval-test-"));
  markPreflightDoneForTest();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  mock.restore();
});

// ---------------------------------------------------------------------------
// cleanGeneratedOutput
// ---------------------------------------------------------------------------

describe("cleanGeneratedOutput", () => {
  test("strips closing fence and prose after code", () => {
    const input = [
      "import React from 'react';",
      "export const Foo = () => <div/>;",
      "```",
      "This is a wrapper component...<|im_end|>",
    ].join("\n");
    const result = cleanGeneratedOutput(input);
    expect(result).toBe("import React from 'react';\nexport const Foo = () => <div/>;");
  });

  test("extracts code from fenced block when output starts with fence", () => {
    const input = "```tsx\nexport const x = 1;\n```\nSome explanation.";
    const result = cleanGeneratedOutput(input);
    expect(result).toBe("export const x = 1;");
  });

  test("strips im_end token without fence", () => {
    const input = "export const x = 1;\n<|im_end|>";
    const result = cleanGeneratedOutput(input);
    expect(result).toBe("export const x = 1;");
  });

  test("returns original when no fence or token present", () => {
    const input = "export const x = 1;\n";
    const result = cleanGeneratedOutput(input);
    expect(result).toBe("export const x = 1;");
  });
});

// ---------------------------------------------------------------------------
// runTscCheck
// ---------------------------------------------------------------------------

describe("runTscCheck", () => {
  test("returns pass:true for syntactically valid TypeScript", async () => {
    const file = join(tempDir, "valid.ts");
    writeFileSync(file, "const x: number = 1;\nexport {};\n");
    const result = await runTscCheck(file);
    expect(result.pass).toBe(true);
    expect(result.output).toBe("");
  });

  test("returns pass:false and output for TypeScript with a type error", async () => {
    const file = join(tempDir, "invalid.ts");
    writeFileSync(file, "const x: number = 'not a number';\nexport {};\n");
    const result = await runTscCheck(file);
    expect(result.pass).toBe(false);
    expect(result.output).toContain("error TS");
  });

  test("returns pass:true for valid React component with unresolved imports", async () => {
    const file = join(tempDir, "Button.tsx");
    writeFileSync(file, [
      "import React from 'react';",
      "import { Button } from '@mui/material';",
      "interface Props { label: string; }",
      "export const MyButton: React.FC<Props> = ({ label }) => <Button>{label}</Button>;",
    ].join("\n") + "\n");
    const result = await runTscCheck(file);
    expect(result.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runEslintCheck
// ---------------------------------------------------------------------------

describe("runEslintCheck", () => {
  test("returns pass:true for a clean file using project config", async () => {
    const file = join(tempDir, "clean.ts");
    writeFileSync(file, "export const x = 1;\n");
    const result = await runEslintCheck(file);
    expect(result.pass).toBe(true);
  });

  test("returns pass:false and output for a file with eslint errors", async () => {
    const file = join(tempDir, "dirty.ts");
    // 'any' type is banned by the project eslint config
    writeFileSync(file, "export const x: any = 1;\n");
    const result = await runEslintCheck(file);
    expect(result.pass).toBe(false);
    expect(result.output).toContain("any");
  });
});

// ---------------------------------------------------------------------------
// computeComposite
// ---------------------------------------------------------------------------

describe("computeComposite", () => {
  test("all pass → 1.0", () => {
    expect(computeComposite({ tsc: 1, eslint: 1, tests: 1 })).toBeCloseTo(1.0);
  });

  test("all fail → 0.0", () => {
    expect(computeComposite({ tsc: 0, eslint: 0, tests: 0 })).toBeCloseTo(0.0);
  });

  test("tsc only → 0.4", () => {
    expect(computeComposite({ tsc: 1, eslint: 0, tests: 0 })).toBeCloseTo(0.4);
  });

  test("eslint only → 0.3", () => {
    expect(computeComposite({ tsc: 0, eslint: 1, tests: 0 })).toBeCloseTo(0.3);
  });

  test("tests only → 0.3", () => {
    expect(computeComposite({ tsc: 0, eslint: 0, tests: 1 })).toBeCloseTo(0.3);
  });

  test("tsc + eslint → 0.7", () => {
    expect(computeComposite({ tsc: 1, eslint: 1, tests: 0 })).toBeCloseTo(0.7);
  });
});

// ---------------------------------------------------------------------------
// formatEvalTable
// ---------------------------------------------------------------------------

function makeSummary(): EvalSummary {
  return {
    records: [
      {
        prompt: "write a debounce function",
        scores: { tsc: 1, eslint: 1, tests: 1 },
        composite: 1.0,
        generatedCode: "export function debounce() {}",
        diagnostics: { tsc: "", eslint: "", tests: "" },
      },
      {
        prompt: "write a throttle function",
        scores: { tsc: 0, eslint: 1, tests: 0 },
        composite: 0.3,
        generatedCode: "export const throttle: any = () => {}",
        diagnostics: { tsc: "error TS2345: Type mismatch", eslint: "", tests: "expected true" },
      },
    ],
    meanTsc: 0.5,
    meanEslint: 1.0,
    meanTests: 0.5,
    meanComposite: 0.65,
  };
}

describe("formatEvalTable", () => {

  test("contains header columns", () => {
    const table = formatEvalTable(makeSummary());
    expect(table).toContain("TSC");
    expect(table).toContain("ESLINT");
    expect(table).toContain("TESTS");
    expect(table).toContain("COMPOSITE");
  });

  test("contains MEAN row", () => {
    const table = formatEvalTable(makeSummary());
    expect(table).toContain("MEAN");
  });

  test("contains truncated prompt", () => {
    const table = formatEvalTable(makeSummary());
    expect(table).toContain("write a debounce");
  });

  test("long prompt is truncated to 40 chars", () => {
    const summary: EvalSummary = {
      records: [
        {
          prompt: "a".repeat(60),
          scores: { tsc: 1, eslint: 1, tests: 1 },
          composite: 1.0,
          generatedCode: "export const x = 1;",
          diagnostics: { tsc: "", eslint: "", tests: "" },
        },
      ],
      meanTsc: 1,
      meanEslint: 1,
      meanTests: 1,
      meanComposite: 1.0,
    };
    const table = formatEvalTable(summary);
    expect(table).not.toContain("a".repeat(60));
    expect(table).toContain("a".repeat(40));
  });
});

// ---------------------------------------------------------------------------
// formatEvalReport
// ---------------------------------------------------------------------------

describe("formatEvalReport", () => {
  test("contains prompt text", () => {
    const report = formatEvalReport(makeSummary());
    expect(report).toContain("write a debounce function");
    expect(report).toContain("write a throttle function");
  });

  test("contains generated code", () => {
    const report = formatEvalReport(makeSummary());
    expect(report).toContain("export function debounce");
    expect(report).toContain("export const throttle");
  });

  test("contains pass/fail icons", () => {
    const report = formatEvalReport(makeSummary());
    expect(report).toContain("✓");
    expect(report).toContain("✗");
  });

  test("contains diagnostic output when scorer failed", () => {
    const report = formatEvalReport(makeSummary());
    expect(report).toContain("error TS2345");
    expect(report).toContain("expected true");
  });

  test("does not include empty diagnostic blocks", () => {
    const summary = makeSummary();
    // First record has all empty diagnostics and all passing
    const report = formatEvalReport(summary);
    // The passing record's tsc block should not have a code fence with nothing in it
    expect(report).not.toMatch(/TSC 1\.0 ✓\s*```\s*```/);
  });

  test("summary table appears at top", () => {
    const report = formatEvalReport(makeSummary());
    const compositeIdx = report.indexOf("Composite");
    const firstPromptIdx = report.indexOf("write a debounce");
    expect(compositeIdx).toBeLessThan(firstPromptIdx);
  });
});

// ---------------------------------------------------------------------------
// runEval — dry-run
// ---------------------------------------------------------------------------

describe("runEval — dry-run", () => {
  test("returns composite 0.5 per record without spawning", async () => {
    const dataDir = join(tempDir, "data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "eval.jsonl"),
      [
        JSON.stringify({ prompt: "prompt A", completion: "completion A" }),
        JSON.stringify({ prompt: "prompt B", completion: "completion B" }),
      ].join("\n") + "\n",
    );

    const summary = await runEval(tempDir, {
      modelPath: "/any/model",
      dryRun: true,
    });

    expect(summary.records).toHaveLength(2);
    for (const rec of summary.records) {
      expect(rec.composite).toBeCloseTo(0.5);
      expect(rec.scores.tsc).toBe(0.5);
      expect(rec.scores.eslint).toBe(0.5);
      expect(rec.scores.tests).toBe(0.5);
    }
    expect(summary.meanComposite).toBeCloseTo(0.5);
  });

  test("throws when eval.jsonl does not exist and no --input provided", async () => {
    let threw = false;
    try {
      await runEval(tempDir, { modelPath: "/any/model", dryRun: true });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("uses --input override when provided", async () => {
    const inputFile = join(tempDir, "custom.jsonl");
    writeFileSync(
      inputFile,
      JSON.stringify({ prompt: "custom prompt", completion: "x" }) + "\n",
    );

    const summary = await runEval(tempDir, {
      modelPath: "/any/model",
      inputFile,
      dryRun: true,
    });

    expect(summary.records).toHaveLength(1);
    expect(summary.records[0].prompt).toBe("custom prompt");
  });
});

// ---------------------------------------------------------------------------
// updateManifestScore
// ---------------------------------------------------------------------------

describe("updateManifestScore", () => {
  test("writes eval_pass_rate to manifest", () => {
    const manifestPath = join(tempDir, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        name: "react-ts",
        version: "1.0.0",
        eval_pass_rate: 0.0,
      }),
    );

    updateManifestScore(manifestPath, 0.75, false);

    const updated = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      eval_pass_rate: number;
    };
    expect(updated.eval_pass_rate).toBeCloseTo(0.75);
  });

  test("writes baseline_pass_rate when isBaseline=true", () => {
    const manifestPath = join(tempDir, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({ name: "react-ts", version: "1.0.0", eval_pass_rate: 0.0 }),
    );

    updateManifestScore(manifestPath, 0.6, true);

    const updated = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      baseline_pass_rate: number;
      eval_pass_rate: number;
    };
    expect(updated.baseline_pass_rate).toBeCloseTo(0.6);
    expect(updated.eval_pass_rate).toBe(0.0); // unchanged
  });

  test("preserves other manifest fields", () => {
    const manifestPath = join(tempDir, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({ name: "react-ts", version: "2.1.0", eval_pass_rate: 0.0, author: "test" }),
    );

    updateManifestScore(manifestPath, 0.8, false);

    const updated = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      name: string;
      version: string;
      author: string;
    };
    expect(updated.name).toBe("react-ts");
    expect(updated.version).toBe("2.1.0");
    expect(updated.author).toBe("test");
  });

  test("does nothing if manifest does not exist", () => {
    expect(() =>
      updateManifestScore(join(tempDir, "missing.json"), 0.5, false),
    ).not.toThrow();
  });

  test("does nothing if eval.jsonl is empty", async () => {
    const dataDir = join(tempDir, "data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "eval.jsonl"), "");

    const summary = await runEval(tempDir, { modelPath: "/any", dryRun: true });
    expect(summary.records).toHaveLength(0);
    expect(summary.meanComposite).toBe(0);
  });
});
