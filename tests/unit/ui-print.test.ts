import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { initUiContext, resetUiContextForTest } from "../../src/ui/context.js";
import { stripAnsi } from "../../src/ui/ansi.js";

// Import print functions fresh each test via the module
import { info, warn, error, success, dim, out, divider, scoreDelta } from "../../src/ui/print.js";

// Capture stderr/stdout writes
let stderrLines: string[] = [];
let stdoutLines: string[] = [];

beforeEach(() => {
  resetUiContextForTest();
  initUiContext({ isTTY: false }); // deterministic: no ANSI codes in output
  stderrLines = [];
  stdoutLines = [];
  spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrLines.push(stripAnsi(String(chunk)));
    return true;
  });
  spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdoutLines.push(stripAnsi(String(chunk)));
    return true;
  });
});

afterEach(() => {
  resetUiContextForTest();
});

describe("ui.info", () => {
  test("outputs [INFO] prefix to stderr", () => {
    info("hello world");
    expect(stderrLines.some((l) => l.includes("[INFO]") && l.includes("hello world"))).toBe(true);
  });

  test("suppressed when quiet=true", () => {
    initUiContext({ quiet: true });
    info("should be suppressed");
    expect(stderrLines).toHaveLength(0);
  });
});

describe("ui.warn", () => {
  test("outputs [WARN] prefix to stderr", () => {
    warn("something off");
    expect(stderrLines.some((l) => l.includes("[WARN]") && l.includes("something off"))).toBe(true);
  });

  test("suppressed when quiet=true", () => {
    initUiContext({ quiet: true });
    warn("nope");
    expect(stderrLines).toHaveLength(0);
  });
});

describe("ui.error", () => {
  test("outputs [ERROR] prefix to stderr", () => {
    error("boom");
    expect(stderrLines.some((l) => l.includes("[ERROR]") && l.includes("boom"))).toBe(true);
  });

  test("NOT suppressed when quiet=true (errors always show)", () => {
    initUiContext({ quiet: true });
    error("always visible");
    expect(stderrLines.some((l) => l.includes("[ERROR]"))).toBe(true);
  });
});

describe("ui.success", () => {
  test("outputs ✓ to stderr", () => {
    success("done");
    expect(stderrLines.some((l) => l.includes("✓") && l.includes("done"))).toBe(true);
  });

  test("suppressed when quiet=true", () => {
    initUiContext({ quiet: true });
    success("done");
    expect(stderrLines).toHaveLength(0);
  });
});

describe("ui.dim", () => {
  test("outputs message to stderr", () => {
    dim("detail");
    expect(stderrLines.some((l) => l.includes("detail"))).toBe(true);
  });

  test("suppressed when quiet=true", () => {
    initUiContext({ quiet: true });
    dim("detail");
    expect(stderrLines).toHaveLength(0);
  });
});

describe("ui.out", () => {
  test("writes to stdout", () => {
    out("output data\n");
    expect(stdoutLines.some((l) => l.includes("output data"))).toBe(true);
  });

  test("never suppressed when quiet=true", () => {
    initUiContext({ quiet: true });
    out("data\n");
    expect(stdoutLines.some((l) => l.includes("data"))).toBe(true);
  });
});

describe("ui.divider", () => {
  test("renders label between dashes", () => {
    divider("Section");
    expect(stderrLines.some((l) => l.includes("Section"))).toBe(true);
  });

  test("renders plain dashes with no label", () => {
    divider();
    expect(stderrLines.some((l) => l.includes("─"))).toBe(true);
  });

  test("suppressed when quiet=true", () => {
    initUiContext({ quiet: true });
    divider("hidden");
    expect(stderrLines).toHaveLength(0);
  });
});

describe("ui.scoreDelta", () => {
  test("positive delta prefixed with +", () => {
    const result = stripAnsi(scoreDelta(0.042));
    expect(result).toBe("+0.042");
  });

  test("negative delta has − sign", () => {
    const result = stripAnsi(scoreDelta(-0.018));
    expect(result).toBe("-0.018");
  });

  test("zero is prefixed with +", () => {
    const result = stripAnsi(scoreDelta(0));
    expect(result).toBe("+0.000");
  });
});
