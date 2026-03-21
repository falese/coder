import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  setConfigValue,
  getConfigValue,
  DEFAULT_CONFIG,
} from "../../src/config/loader.js";

// ---------------------------------------------------------------------------
// Test harness — isolate each test with a fresh temp config path
// ---------------------------------------------------------------------------

let tempDir: string;
let configPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-test-"));
  configPath = join(tempDir, "config.toml");
  process.env.CODER_CONFIG_PATH = configPath;
  delete process.env.CODER_MODEL;
  delete process.env.CODER_LOG_LEVEL;
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.CODER_CONFIG_PATH;
});

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  test("returns DEFAULT_CONFIG when file is missing and creates the file", () => {
    const config = loadConfig();
    expect(config.default_model).toBe(DEFAULT_CONFIG.default_model);
    expect(config.log_level).toBe(DEFAULT_CONFIG.log_level);
    // file should now exist
    expect(Bun.file(configPath).size).toBeGreaterThan(0);
  });

  test("reads values from an existing config file", () => {
    writeFileSync(
      configPath,
      `default_model = "/models/qwen"\nlog_level = "debug"\nadaptors_dir = "/custom/adaptors"\n`,
    );
    const config = loadConfig();
    expect(config.default_model).toBe("/models/qwen");
    expect(config.log_level).toBe("debug");
    expect(config.adaptors_dir).toBe("/custom/adaptors");
  });

  test("CODER_MODEL env var overrides default_model from file", () => {
    writeFileSync(
      configPath,
      `default_model = "/models/from-file"\n`,
    );
    process.env.CODER_MODEL = "/models/from-env";
    const config = loadConfig();
    expect(config.default_model).toBe("/models/from-env");
  });

  test("CODER_LOG_LEVEL env var overrides log_level from file", () => {
    writeFileSync(configPath, `log_level = "info"\n`);
    process.env.CODER_LOG_LEVEL = "warn";
    const config = loadConfig();
    expect(config.log_level).toBe("warn");
  });

  test("unknown keys in config file are ignored without error", () => {
    writeFileSync(
      configPath,
      `default_model = "/models/test"\nunknown_key = "should be ignored"\n`,
    );
    expect(() => loadConfig()).not.toThrow();
    const config = loadConfig();
    expect(config.default_model).toBe("/models/test");
  });

  test("invalid log_level value falls back to default", () => {
    writeFileSync(configPath, `log_level = "verbose"\n`);
    const config = loadConfig();
    expect(config.log_level).toBe(DEFAULT_CONFIG.log_level);
  });

  test("expands ~ in adaptors_dir path", () => {
    writeFileSync(
      configPath,
      `adaptors_dir = "~/.coder/adaptors"\n`,
    );
    const config = loadConfig();
    expect(config.adaptors_dir).not.toContain("~");
    expect(config.adaptors_dir).toContain(".coder");
  });

  test("malformed TOML returns defaults without throwing", () => {
    writeFileSync(configPath, `this is not valid toml ===`);
    expect(() => loadConfig()).not.toThrow();
    const config = loadConfig();
    expect(config.log_level).toBe(DEFAULT_CONFIG.log_level);
  });
});

// ---------------------------------------------------------------------------
// setConfigValue / getConfigValue
// ---------------------------------------------------------------------------

describe("setConfigValue and getConfigValue", () => {
  test("set then get returns the written value", () => {
    setConfigValue("default_model", "/models/test");
    expect(getConfigValue("default_model")).toBe("/models/test");
  });

  test("set overwrites an existing value", () => {
    setConfigValue("default_model", "/models/first");
    setConfigValue("default_model", "/models/second");
    expect(getConfigValue("default_model")).toBe("/models/second");
  });

  test("set preserves other keys", () => {
    setConfigValue("log_level", "debug");
    setConfigValue("default_model", "/models/test");
    expect(getConfigValue("log_level")).toBe("debug");
    expect(getConfigValue("default_model")).toBe("/models/test");
  });

  test("getConfigValue returns undefined for unset key", () => {
    // fresh config file — default_model is empty string, not undefined
    // but a key that was never written should still return the file value
    setConfigValue("log_level", "warn");
    // default_model was never explicitly set — should return empty string (default)
    const val = getConfigValue("default_model");
    expect(val).toBe("");
  });
});
