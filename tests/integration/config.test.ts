import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const BUN = process.execPath;
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

let tempDir: string;
let configPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-int-test-"));
  configPath = join(tempDir, "config.toml");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function runCLI(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([BUN, CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CODER_CONFIG_PATH: configPath, ...env },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("coder config set", () => {
  test("sets a key and exits 0", async () => {
    const { exitCode } = await runCLI(["config", "set", "default_model", "/models/qwen"]);
    expect(exitCode).toBe(0);
  });

  test("rejects an unknown key with exit 1", async () => {
    const { exitCode, stderr } = await runCLI(["config", "set", "unknown_key", "value"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("unknown_key");
  });
});

describe("coder config get", () => {
  test("gets a previously set value", async () => {
    await runCLI(["config", "set", "default_model", "/models/qwen"]);
    const { stdout, exitCode } = await runCLI(["config", "get", "default_model"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("/models/qwen");
  });

  test("rejects an unknown key with exit 1", async () => {
    const { exitCode, stderr } = await runCLI(["config", "get", "bad_key"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("bad_key");
  });
});

describe("coder config show", () => {
  test("prints all config keys and exits 0", async () => {
    const { stdout, exitCode } = await runCLI(["config", "show"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("default_model");
    expect(stdout).toContain("log_level");
    expect(stdout).toContain("adaptors_dir");
  });

  test("reflects a set value in show output", async () => {
    await runCLI(["config", "set", "log_level", "debug"]);
    const { stdout } = await runCLI(["config", "show"]);
    expect(stdout).toContain("debug");
  });
});

describe("generate command respects config default_model", () => {
  test("exits 0 without --model when default_model is set in config", async () => {
    await runCLI(["config", "set", "default_model", "/models/test"]);
    const { exitCode, stdout } = await runCLI(
      ["generate", "write a sort"],
      { CODER_DRY_RUN: "1" },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# dry-run: write a sort");
  });

  test("exits non-zero without --model when default_model is empty", async () => {
    const { exitCode, stderr } = await runCLI(["generate", "write a sort"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("model");
  });

  test("--model flag overrides config default_model", async () => {
    await runCLI(["config", "set", "default_model", "/models/from-config"]);
    const { exitCode, stdout } = await runCLI(
      ["generate", "write a sort", "--model", "/models/from-flag"],
      { CODER_DRY_RUN: "1" },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# dry-run: write a sort");
  });
});
