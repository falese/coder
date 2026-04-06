import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Logger } from "../../src/observability/logger.js";
import type { CoderConfig } from "../../src/config/types.js";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let tempDir: string;

function makeConfig(overrides: Partial<CoderConfig> = {}): CoderConfig {
  return {
    default_model: "",
    adaptors_dir: join(tempDir, "adaptors"),
    models_dir: join(tempDir, "models"),
    logs_dir: join(tempDir, "logs"),
    log_level: "info",
    capture_prompts: false,
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-logger-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.CODER_LOG_LEVEL;
});

function readLogLines(logsDir: string): Record<string, unknown>[] {
  const logPath = join(logsDir, "coder.log");
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Logger class
// ---------------------------------------------------------------------------

describe("Logger", () => {
  test("info writes a JSON line to the log file", () => {
    const logger = new Logger(makeConfig());
    logger.info("hello world");
    const lines = readLogLines(join(tempDir, "logs"));
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("info");
    expect(lines[0].msg).toBe("hello world");
    expect(typeof lines[0].ts).toBe("string");
  });

  test("debug does not write to stderr at info level", () => {
    const logger = new Logger(makeConfig({ log_level: "info" }));
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      logger.debug("quiet message");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("debug still writes to log file regardless of log_level", () => {
    const logger = new Logger(makeConfig({ log_level: "info" }));
    logger.debug("file-only");
    const lines = readLogLines(join(tempDir, "logs"));
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("debug");
  });

  test("warn writes to log file AND stderr", () => {
    const logger = new Logger(makeConfig({ log_level: "info" }));
    let stderrOutput = "";
    const spy = spyOn(process.stderr, "write").mockImplementation((msg) => {
      stderrOutput += String(msg);
      return true;
    });
    try {
      logger.warn("heads up");
      const lines = readLogLines(join(tempDir, "logs"));
      expect(lines).toHaveLength(1);
      expect(lines[0].level).toBe("warn");
      expect(stderrOutput).toContain("heads up");
    } finally {
      spy.mockRestore();
    }
  });

  test("debug writes to stderr when log_level is debug", () => {
    const logger = new Logger(makeConfig({ log_level: "debug" }));
    let stderrOutput = "";
    const spy = spyOn(process.stderr, "write").mockImplementation((msg) => {
      stderrOutput += String(msg);
      return true;
    });
    try {
      logger.debug("verbose message");
      expect(stderrOutput).toContain("verbose message");
    } finally {
      spy.mockRestore();
    }
  });

  test("logEvent writes structured JSON with event field", () => {
    const logger = new Logger(makeConfig());
    logger.logEvent({
      event: "generation_start",
      ts: new Date().toISOString(),
      model: "test-model",
    });
    const lines = readLogLines(join(tempDir, "logs"));
    expect(lines).toHaveLength(1);
    expect(lines[0].event).toBe("generation_start");
    expect(lines[0].model).toBe("test-model");
  });

  test("logEvent for generation_complete includes ttft_ms and tok_s", () => {
    const logger = new Logger(makeConfig());
    logger.logEvent({
      event: "generation_complete",
      ts: new Date().toISOString(),
      model: "test-model",
      ttft_ms: 812,
      tok_s: 34.2,
      tokens: 256,
    });
    const lines = readLogLines(join(tempDir, "logs"));
    expect(lines[0].ttft_ms).toBe(812);
    expect(lines[0].tok_s).toBe(34.2);
    expect(lines[0].tokens).toBe(256);
  });

  test("log file and directory are created if logs_dir does not exist", () => {
    const nestedLogsDir = join(tempDir, "deep", "nested", "logs");
    const logger = new Logger(makeConfig({ logs_dir: nestedLogsDir }));
    logger.info("creating dirs");
    expect(existsSync(join(nestedLogsDir, "coder.log"))).toBe(true);
  });

  test("multiple log calls append lines to the same file", () => {
    const logger = new Logger(makeConfig());
    logger.info("line one");
    logger.info("line two");
    logger.warn("line three");
    const lines = readLogLines(join(tempDir, "logs"));
    expect(lines).toHaveLength(3);
  });
});
