import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { capturePrompt, loadSamplePrompts } from "../../src/adaptors/prompt-log.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdaptorDir(withPromptLog = false, entries: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "coder-capture-test-"));
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(
    join(dir, "data", "eval.jsonl"),
    JSON.stringify({ prompt: "// eval prompt", completion: "const x = 1;" }) + "\n",
  );
  if (withPromptLog && entries.length > 0) {
    writeFileSync(
      join(dir, "data", "prompt-log.jsonl"),
      entries.map((p) => JSON.stringify({ prompt: p, ts: "2026-04-05T00:00:00.000Z" })).join("\n") + "\n",
    );
  }
  return dir;
}

let adaptorDir: string;

beforeEach(() => {
  adaptorDir = makeAdaptorDir();
});

afterEach(() => {
  rmSync(adaptorDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// capturePrompt
// ---------------------------------------------------------------------------

describe("capturePrompt", () => {
  test("creates prompt-log.jsonl and appends entry", () => {
    capturePrompt("add a confirm dialog", adaptorDir, "2.0.5");

    const logFile = join(adaptorDir, "data", "prompt-log.jsonl");
    expect(existsSync(logFile)).toBe(true);
    const lines = readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as { prompt: string; ts: string; adaptor_version: string };
    expect(entry.prompt).toBe("add a confirm dialog");
    expect(entry.adaptor_version).toBe("2.0.5");
    expect(typeof entry.ts).toBe("string");
  });

  test("appends multiple entries on successive calls", () => {
    capturePrompt("first prompt", adaptorDir);
    capturePrompt("second prompt", adaptorDir);

    const logFile = join(adaptorDir, "data", "prompt-log.jsonl");
    const lines = readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[0]) as { prompt: string }).prompt).toBe("first prompt");
    expect((JSON.parse(lines[1]) as { prompt: string }).prompt).toBe("second prompt");
  });

  test("omits adaptor_version when not provided", () => {
    capturePrompt("a prompt", adaptorDir);

    const logFile = join(adaptorDir, "data", "prompt-log.jsonl");
    const entry = JSON.parse(readFileSync(logFile, "utf-8").trim()) as Record<string, unknown>;
    expect("adaptor_version" in entry).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadSamplePrompts
// ---------------------------------------------------------------------------

describe("loadSamplePrompts", () => {
  const evalPrompts = ["// eval prompt one", "// eval prompt two"];

  test("falls back to eval prompts when prompt-log.jsonl is absent", () => {
    const { prompts, source } = loadSamplePrompts(adaptorDir, evalPrompts);
    expect(source).toBe("eval-fallback");
    expect(prompts).toEqual(evalPrompts);
  });

  test("uses prompt-log prompts when file is present", () => {
    const dir = makeAdaptorDir(true, [
      "write a MUI Button component with onClick handler that accepts variant and color props",
      "add a themed TextField with error state and helper text using MUI TextField component",
    ]);
    const { prompts, source } = loadSamplePrompts(dir, evalPrompts);
    rmSync(dir, { recursive: true, force: true });

    expect(source).toBe("prompt-log");
    expect(prompts).toContain("write a MUI Button component with onClick handler that accepts variant and color props");
    expect(prompts).toContain("add a themed TextField with error state and helper text using MUI TextField component");
    expect(prompts).not.toContain("// eval prompt one");
  });

  test("filters out prompts below 20 token threshold (~80 chars)", () => {
    // "hi" is ~0.5 tokens — well below 20
    const dir = makeAdaptorDir(true, [
      "hi",
      "write a MUI Button component with onClick handler that accepts variant and color props",
    ]);
    const { prompts, source } = loadSamplePrompts(dir, evalPrompts);
    rmSync(dir, { recursive: true, force: true });

    expect(source).toBe("prompt-log");
    expect(prompts).not.toContain("hi");
    expect(prompts.length).toBe(1);
  });

  test("filters out prompts above 1500 token threshold (~6000 chars)", () => {
    const longPrompt = "x".repeat(6001); // >1500 tokens
    const goodPrompt = "write a MUI Button component with onClick handler that accepts variant and color props";
    const dir = makeAdaptorDir(true, [longPrompt, goodPrompt]);
    const { prompts, source } = loadSamplePrompts(dir, evalPrompts);
    rmSync(dir, { recursive: true, force: true });

    expect(source).toBe("prompt-log");
    expect(prompts).not.toContain(longPrompt);
    expect(prompts).toContain(goodPrompt);
  });

  test("deduplicates near-identical prompts before returning", () => {
    // Prompts must be > 80 chars (20 tokens) to survive the min-token filter
    const longPrompt = "write a MUI Button component with onClick handler that accepts variant and color props";
    const dir = makeAdaptorDir(true, [longPrompt, longPrompt]); // exact duplicate
    const { prompts } = loadSamplePrompts(dir, evalPrompts);
    rmSync(dir, { recursive: true, force: true });

    expect(prompts.length).toBe(1);
  });

  test("falls back to eval prompts when all entries are filtered out", () => {
    // All prompts too short
    const dir = makeAdaptorDir(true, ["hi", "ok", "yes"]);
    const { prompts, source } = loadSamplePrompts(dir, evalPrompts);
    rmSync(dir, { recursive: true, force: true });

    expect(source).toBe("eval-fallback");
    expect(prompts).toEqual(evalPrompts);
  });

  test("falls back to eval prompts when prompt-log is empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "coder-capture-empty-"));
    mkdirSync(join(dir, "data"), { recursive: true });
    writeFileSync(join(dir, "data", "prompt-log.jsonl"), "");
    const { prompts, source } = loadSamplePrompts(dir, evalPrompts);
    rmSync(dir, { recursive: true, force: true });

    expect(source).toBe("eval-fallback");
    expect(prompts).toEqual(evalPrompts);
  });
});
