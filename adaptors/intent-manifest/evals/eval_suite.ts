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
import { createRequire } from "node:module";

// `@seans-mfe/plugin-coder` is CommonJS and its `exports` map declares only the
// `require` condition, so an ESM `import` of it does not resolve. Load it
// through `createRequire` — the package's own supported entry point — and fail
// with the fix rather than a bare module-not-found if it is not linked.
interface ValidationError { path: string; message: string }
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  manifest?: { type?: string; language?: string; capabilities?: unknown };
}
interface CoderOracle {
  validateManifestText: (text: string) => ValidationResult;
}

function loadOracle(): CoderOracle {
  try {
    return createRequire(import.meta.url)("@seans-mfe/plugin-coder") as CoderOracle;
  } catch (err) {
    throw new Error(
      "@seans-mfe/plugin-coder is not resolvable from the eval sandbox. Build it " +
        "(`npx tsc -b packages/plugin-coder` in seans-mfe-tool) and link it into " +
        "coder's node_modules — see this pack's README. Cause: " +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

const { validateManifestText } = loadOracle();

const generatedPath = process.env.CODER_EVAL_OUTPUT;
if (!generatedPath) throw new Error("CODER_EVAL_OUTPUT not set");
if (!existsSync(generatedPath)) throw new Error(`Generated file not found: ${generatedPath}`);

const generated = readFileSync(generatedPath, "utf-8");
const result = validateManifestText(generated);

const DSL_TYPES = ["tool", "agent", "feature", "service", "remote", "shell", "bff"];
const DSL_LANGUAGES = ["javascript", "typescript", "python", "go", "rust", "java"];

describe("intent-manifest eval suite (the DSL validator is the oracle)", () => {
  test("generated manifest is DSL-valid", () => {
    // The load-bearing assertion: schema + semantics both pass. Assert on the
    // formatted errors first so a failure names *which* rule the manifest broke
    // — that diff is what lands in `coder adaptor eval --report`.
    expect(result.errors.map((e) => `${e.path}: ${e.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
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
