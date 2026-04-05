/**
 * react-ts-v2 adaptor eval suite
 *
 * Runs via: CODER_EVAL_OUTPUT=<tempfile> bun test evals/eval_suite.ts
 *
 * Each test loads the generated output from CODER_EVAL_OUTPUT and asserts
 * structural properties. Tests are intentionally lenient — they check for
 * the presence of key constructs rather than exact content.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";

const generatedPath = process.env.CODER_EVAL_OUTPUT;
if (!generatedPath) throw new Error("CODER_EVAL_OUTPUT not set");
if (!existsSync(generatedPath)) throw new Error(`Generated file not found: ${generatedPath}`);

const generatedSource = readFileSync(generatedPath, "utf-8");

describe("react-ts-v2 eval suite", () => {
  test("generated output is non-empty", () => {
    expect(generatedSource.trim().length).toBeGreaterThan(0);
  });

  test("generated output does not contain raw error messages", () => {
    expect(generatedSource).not.toContain("SyntaxError");
    expect(generatedSource).not.toContain("TypeError");
    expect(generatedSource).not.toContain("undefined is not");
  });

  test("generated output contains TypeScript constructs", () => {
    const hasTs =
      generatedSource.includes("interface ") ||
      generatedSource.includes("type ") ||
      generatedSource.includes(": React.FC") ||
      generatedSource.includes("export ") ||
      generatedSource.includes("function ") ||
      generatedSource.includes("const ");
    expect(hasTs).toBe(true);
  });

  test("generated output has matching braces", () => {
    let depth = 0;
    for (const ch of generatedSource) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    expect(depth).toBe(0);
  });
});
