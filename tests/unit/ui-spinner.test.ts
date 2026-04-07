import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { initUiContext, resetUiContextForTest } from "../../src/ui/context.js";
import { Spinner } from "../../src/ui/spinner.js";
import { stripAnsi } from "../../src/ui/ansi.js";

let stderrLines: string[] = [];

function captured(): string {
  return stderrLines.map(stripAnsi).join("");
}

beforeEach(() => {
  resetUiContextForTest();
  initUiContext({ isTTY: false }); // non-TTY for deterministic output
  stderrLines = [];
  spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrLines.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  resetUiContextForTest();
});

describe("Spinner — non-TTY mode", () => {
  test("start() prints label followed by ...", () => {
    new Spinner("Loading").start();
    expect(captured()).toContain("Loading...");
  });

  test("succeed() prints ✓ and label", () => {
    const s = new Spinner("Work");
    s.start();
    stderrLines = [];
    s.succeed("all done");
    expect(captured()).toContain("✓");
    expect(captured()).toContain("all done");
  });

  test("succeed() falls back to constructor label if none given", () => {
    const s = new Spinner("My task");
    s.start();
    stderrLines = [];
    s.succeed();
    expect(captured()).toContain("My task");
  });

  test("fail() prints ✗ and label", () => {
    const s = new Spinner("Work");
    s.start();
    stderrLines = [];
    s.fail("went wrong");
    expect(captured()).toContain("✗");
    expect(captured()).toContain("went wrong");
  });

  test("update() changes label used by succeed", () => {
    const s = new Spinner("old");
    s.start();
    s.update("new label");
    stderrLines = [];
    s.succeed();
    expect(captured()).toContain("new label");
  });
});

describe("Spinner — quiet mode", () => {
  test("start() is a no-op when quiet=true", () => {
    initUiContext({ quiet: true });
    new Spinner("Task").start();
    expect(stderrLines).toHaveLength(0);
  });

  test("succeed() is a no-op when quiet=true", () => {
    initUiContext({ quiet: true });
    const s = new Spinner("Task");
    s.start();
    s.succeed("done");
    expect(stderrLines).toHaveLength(0);
  });

  test("fail() is a no-op when quiet=true", () => {
    initUiContext({ quiet: true });
    const s = new Spinner("Task");
    s.start();
    s.fail("nope");
    expect(stderrLines).toHaveLength(0);
  });
});

describe("Spinner — dryRun mode", () => {
  test("start() is a no-op when dryRun=true", () => {
    initUiContext({ dryRun: true });
    new Spinner("Task").start();
    expect(stderrLines).toHaveLength(0);
  });
});
