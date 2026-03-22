import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateRecord,
  validateFile,
} from "../../src/data/validate.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-validate-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("validateRecord", () => {
  test("returns valid for a well-formed record", () => {
    const result = validateRecord({ prompt: "write a function", completion: "function foo() {}" });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("returns invalid for empty prompt", () => {
    const result = validateRecord({ prompt: "", completion: "function foo() {}" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("prompt is empty");
  });

  test("returns invalid for empty completion", () => {
    const result = validateRecord({ prompt: "write a function", completion: "" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("completion is empty");
  });

  test("returns invalid when prompt token count exceeds 2048", () => {
    // chars/4 > 2048 → chars > 8192
    const longPrompt = "x".repeat(8193);
    const result = validateRecord({ prompt: longPrompt, completion: "short" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("prompt"))).toBe(true);
  });

  test("returns invalid when completion token count exceeds 2048", () => {
    const longCompletion = "x".repeat(8193);
    const result = validateRecord({ prompt: "short", completion: longCompletion });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("completion"))).toBe(true);
  });

  test("accepts a record right at the 2048 token boundary", () => {
    // exactly 2048 tokens = 8192 chars
    const atLimit = "x".repeat(8192);
    const result = validateRecord({ prompt: atLimit, completion: "ok" });
    expect(result.valid).toBe(true);
  });

  test("returns multiple errors when both fields are empty", () => {
    const result = validateRecord({ prompt: "", completion: "" });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});

describe("validateFile", () => {
  test("returns all-valid summary for a valid JSONL file", () => {
    const content =
      '{"prompt":"write a fn","completion":"function foo() {}"}\n' +
      '{"prompt":"sort array","completion":"arr.sort()"}\n';
    const file = join(tempDir, "data.jsonl");
    writeFileSync(file, content);

    const result = validateFile(file);
    expect(result.total).toBe(2);
    expect(result.invalid).toBe(0);
    expect(result.invalidLines).toHaveLength(0);
  });

  test("reports invalid line numbers for bad records", () => {
    const content =
      '{"prompt":"ok","completion":"fn() {}"}\n' +
      '{"prompt":"","completion":"fn() {}"}\n' +
      '{"prompt":"ok","completion":"fn() {}"}\n';
    const file = join(tempDir, "data.jsonl");
    writeFileSync(file, content);

    const result = validateFile(file);
    expect(result.total).toBe(3);
    expect(result.invalid).toBe(1);
    expect(result.invalidLines).toContain(2);
  });

  test("skips blank lines", () => {
    const content =
      '{"prompt":"a","completion":"b"}\n' +
      "\n" +
      '{"prompt":"c","completion":"d"}\n';
    const file = join(tempDir, "data.jsonl");
    writeFileSync(file, content);

    const result = validateFile(file);
    expect(result.total).toBe(2);
    expect(result.invalid).toBe(0);
  });

  test("reports parse errors as invalid lines", () => {
    const content = '{"prompt":"a","completion":"b"}\nnot-json\n';
    const file = join(tempDir, "data.jsonl");
    writeFileSync(file, content);

    const result = validateFile(file);
    expect(result.invalid).toBe(1);
    expect(result.invalidLines).toContain(2);
  });
});
