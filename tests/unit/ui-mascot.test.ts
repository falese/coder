import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { initUiContext, resetUiContextForTest } from "../../src/ui/context.js";
import { MascotSpinner } from "../../src/ui/mascot.js";
import { stripAnsi } from "../../src/ui/ansi.js";

let stderrLines: string[] = [];

function captured(): string {
  return stderrLines.map(stripAnsi).join("");
}

beforeEach(() => {
  resetUiContextForTest();
  // Non-TTY: MascotSpinner delegates to Spinner behaviour
  initUiContext({ isTTY: false });
  stderrLines = [];
  spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrLines.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  resetUiContextForTest();
});

describe("MascotSpinner — non-TTY degrades to Spinner", () => {
  test("start() prints label...", () => {
    new MascotSpinner("Generating").start();
    expect(captured()).toContain("Generating...");
  });

  test("succeed() prints ✓ and label", () => {
    const m = new MascotSpinner("Generating");
    m.start();
    stderrLines = [];
    m.succeed("First token received");
    expect(captured()).toContain("✓");
    expect(captured()).toContain("First token received");
  });

  test("fail() prints ✗ and label", () => {
    const m = new MascotSpinner("Generating");
    m.start();
    stderrLines = [];
    m.fail("timed out");
    expect(captured()).toContain("✗");
    expect(captured()).toContain("timed out");
  });

  test("update() then succeed uses new label", () => {
    const m = new MascotSpinner("Waiting");
    m.start();
    m.update("Streaming");
    stderrLines = [];
    m.succeed();
    expect(captured()).toContain("Streaming");
  });
});

describe("MascotSpinner — quiet mode", () => {
  test("all methods are no-ops when quiet=true", () => {
    initUiContext({ quiet: true });
    const m = new MascotSpinner("Task");
    m.start();
    m.succeed("done");
    m.fail("fail");
    expect(stderrLines).toHaveLength(0);
  });
});

describe("MascotSpinner — dryRun mode", () => {
  test("start() is a no-op when dryRun=true", () => {
    initUiContext({ dryRun: true });
    new MascotSpinner("Task").start();
    expect(stderrLines).toHaveLength(0);
  });
});
