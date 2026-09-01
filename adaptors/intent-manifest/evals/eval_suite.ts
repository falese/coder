/**
 * intent-manifest adaptor eval suite.
 *
 * Runs via: CODER_EVAL_OUTPUT=<tempfile> bun test evals/eval_suite.ts
 *
 * The oracle is the seans-mfe DSL validator, not tsc/eslint (which are noise for
 * YAML). Per ADR-088 the oracle lives in the first-party in-repo
 * `@seans-mfe/plugin-coder` package (`validateManifestText`), which strips a
 * stray code fence, parses the YAML, and runs `validateFull` from
 * `@seans-mfe/dsl`. The real eval signal therefore lands in coder's **Tests**
 * dimension (spec §6).
 *
 * Resolution: `@seans-mfe/plugin-coder` (and its `@seans-mfe/dsl` dependency)
 * must be resolvable from this sandbox — a workspace link or a published
 * package. See this pack's README. `adaptors/**` is excluded from coder's own
 * tsc/eslint, so this import never affects the coder repo's gates.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { validateManifestText } from "@seans-mfe/plugin-coder";

const generatedPath = process.env.CODER_EVAL_OUTPUT;
if (!generatedPath) throw new Error("CODER_EVAL_OUTPUT not set");
if (!existsSync(generatedPath)) throw new Error(`Generated file not found: ${generatedPath}`);

const generated = readFileSync(generatedPath, "utf-8");
const result = validateManifestText(generated);

const DSL_TYPES = ["tool", "agent", "feature", "service", "remote", "shell", "bff"];
const DSL_LANGUAGES = ["javascript", "typescript", "python", "go", "rust", "java"];

describe("intent-manifest eval suite (the DSL validator is the oracle)", () => {
  test("generated manifest is DSL-valid", () => {
    // The load-bearing assertion: schema + semantics both pass.
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("type is a DSL type-enum member", () => {
    expect(DSL_TYPES).toContain(result.manifest?.type);
  });

  test("language is a DSL language-enum member", () => {
    expect(DSL_LANGUAGES).toContain(result.manifest?.language);
  });

  test("capabilities is an array", () => {
    expect(Array.isArray(result.manifest?.capabilities)).toBe(true);
  });
});
