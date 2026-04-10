import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { initUiContext, resetUiContextForTest } from "../../src/ui/context.js";
import { ByteProgress, StepProgress } from "../../src/ui/progress.js";
import { stripAnsi } from "../../src/ui/ansi.js";

let stderrLines: string[] = [];

function lastLine(): string {
  return stripAnsi(stderrLines[stderrLines.length - 1] ?? "");
}

function allOutput(): string {
  return stderrLines.map(stripAnsi).join("");
}

beforeEach(() => {
  resetUiContextForTest();
  initUiContext({ isTTY: false }); // non-TTY: each update on its own line
  stderrLines = [];
  spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrLines.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  resetUiContextForTest();
});

// ---------------------------------------------------------------------------
// ByteProgress
// ---------------------------------------------------------------------------

describe("ByteProgress.update", () => {
  test("shows percentage when total > 0", () => {
    const p = new ByteProgress("model.safetensors");
    p.update(500_000, 1_000_000);
    expect(lastLine()).toContain("50%");
  });

  test("shows filename (truncated if long)", () => {
    const p = new ByteProgress("weights.safetensors");
    p.update(100_000, 1_000_000);
    expect(lastLine()).toContain("weights");
  });

  test("shows received bytes without total when total=0", () => {
    const p = new ByteProgress("file.bin");
    p.update(2_000_000, 0);
    expect(lastLine()).toContain("MB");
  });

  test("silent when quiet=true", () => {
    initUiContext({ quiet: true });
    const p = new ByteProgress("file.bin");
    p.update(100, 1000);
    expect(stderrLines).toHaveLength(0);
  });
});

describe("ByteProgress.done", () => {
  test("prints ✓ with filename", () => {
    const p = new ByteProgress("model.safetensors");
    p.update(1_000_000, 1_000_000);
    stderrLines = [];
    p.done();
    expect(allOutput()).toContain("✓");
    expect(allOutput()).toContain("model.safetensors");
  });

  test("silent when quiet=true", () => {
    initUiContext({ quiet: true });
    const p = new ByteProgress("file.bin");
    p.done();
    expect(stderrLines).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// StepProgress
// ---------------------------------------------------------------------------

describe("StepProgress.tick", () => {
  test("shows current and total", () => {
    const p = new StepProgress("Evaluating prompt");
    p.tick(3, 5);
    expect(lastLine()).toContain("3");
    expect(lastLine()).toContain("5");
  });

  test("shows percentage", () => {
    const p = new StepProgress("Evaluating prompt");
    p.tick(2, 4);
    expect(lastLine()).toContain("50%");
  });

  test("shows optional detail", () => {
    const p = new StepProgress("Evaluating prompt");
    p.tick(1, 5, "react/Button.tsx");
    expect(lastLine()).toContain("react/Button.tsx");
  });

  test("silent when quiet=true", () => {
    initUiContext({ quiet: true });
    const p = new StepProgress("Eval");
    p.tick(1, 5);
    expect(stderrLines).toHaveLength(0);
  });
});

describe("StepProgress.done", () => {
  test("prints ✓ with summary", () => {
    const p = new StepProgress("Eval");
    p.tick(5, 5);
    stderrLines = [];
    p.done("5/5 prompts evaluated");
    expect(allOutput()).toContain("✓");
    expect(allOutput()).toContain("5/5 prompts evaluated");
  });
});
