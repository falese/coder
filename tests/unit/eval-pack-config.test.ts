import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_EVAL_WEIGHTS,
  loadEvalPackConfig,
  buildEvalArtifact,
  resolveSystemPrompt,
} from "../../src/eval/pack-config.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-evalcfg-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writePackConfig(contents: unknown): void {
  mkdirSync(join(tempDir, "evals"), { recursive: true });
  writeFileSync(
    join(tempDir, "evals", "eval.config.json"),
    JSON.stringify(contents),
  );
}

// ---------------------------------------------------------------------------
// loadEvalPackConfig
// ---------------------------------------------------------------------------

describe("loadEvalPackConfig", () => {
  test("returns the react-ts-compatible defaults when no config file exists", () => {
    const config = loadEvalPackConfig(tempDir);

    expect(config.weights).toEqual(DEFAULT_EVAL_WEIGHTS);
    expect(config.artifact.extension).toBe(".tsx");
    expect(config.artifact.includePrompt).toBe(true);
    expect(config.systemPrompt).toBeUndefined();
    expect(config.maxTokens).toBeUndefined();
  });

  test("reads weights, artifact shape, system prompt and maxTokens", () => {
    writePackConfig({
      weights: { tsc: 0, eslint: 0, tests: 1 },
      artifact: { extension: ".yaml", includePrompt: false },
      systemPrompt: "prompts/system.md",
      maxTokens: 900,
    });

    const config = loadEvalPackConfig(tempDir);

    expect(config.weights).toEqual({ tsc: 0, eslint: 0, tests: 1 });
    expect(config.artifact.extension).toBe(".yaml");
    expect(config.artifact.includePrompt).toBe(false);
    expect(config.systemPrompt).toBe("prompts/system.md");
    expect(config.maxTokens).toBe(900);
  });

  test("fills unspecified fields with defaults", () => {
    writePackConfig({ weights: { tsc: 0, eslint: 0, tests: 1 } });

    const config = loadEvalPackConfig(tempDir);

    expect(config.artifact.extension).toBe(".tsx");
    expect(config.artifact.includePrompt).toBe(true);
  });

  test("rejects an all-zero weight vector", () => {
    writePackConfig({ weights: { tsc: 0, eslint: 0, tests: 0 } });

    expect(() => loadEvalPackConfig(tempDir)).toThrow();
  });

  test("rejects a negative weight", () => {
    writePackConfig({ weights: { tsc: -1, eslint: 1, tests: 1 } });

    expect(() => loadEvalPackConfig(tempDir)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildEvalArtifact
// ---------------------------------------------------------------------------

describe("buildEvalArtifact", () => {
  test("prepends the prompt when includePrompt is true", () => {
    const artifact = buildEvalArtifact("import React from 'react';", "const x = 1;", {
      extension: ".tsx",
      includePrompt: true,
    });

    expect(artifact).toBe("import React from 'react';\nconst x = 1;");
  });

  test("returns the generated text alone when includePrompt is false", () => {
    const artifact = buildEvalArtifact("Build me a cart MFE", "name: cart\n", {
      extension: ".yaml",
      includePrompt: false,
    });

    expect(artifact).toBe("name: cart\n");
  });
});

// ---------------------------------------------------------------------------
// resolveSystemPrompt
// ---------------------------------------------------------------------------

describe("resolveSystemPrompt", () => {
  test("returns undefined when the pack declares no system prompt", () => {
    expect(resolveSystemPrompt(tempDir, undefined)).toBeUndefined();
  });

  test("resolves a pack-relative path against the adaptor dir", () => {
    mkdirSync(join(tempDir, "prompts"), { recursive: true });
    writeFileSync(join(tempDir, "prompts", "system.md"), "emit only yaml");

    expect(resolveSystemPrompt(tempDir, "prompts/system.md")).toBe(
      join(tempDir, "prompts", "system.md"),
    );
  });

  test("throws when the declared system prompt is missing", () => {
    expect(() => resolveSystemPrompt(tempDir, "prompts/system.md")).toThrow(
      /system prompt/i,
    );
  });
});
