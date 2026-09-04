import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BUN = process.execPath;
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

let tempDir: string;
let adaptorsDir: string;
let configPath: string;

// A weightless (inference-only) pack: served base model + system prompt, no
// weights/, no LoRA fields.
const WEIGHTLESS_MANIFEST = {
  name: "drift-audit",
  version: "0.1.0",
  domain: "governance-drift",
  mode: "inference-only",
  base_model: "Qwen2.5-Coder-7B-Instruct",
  author: "",
  description: "Emit a typed drift finding",
};

async function runCLI(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([BUN, CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CODER_CONFIG_PATH: configPath,
      CODER_DRY_RUN: "1",
      ...env,
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-weightless-"));
  adaptorsDir = join(tempDir, "adaptors");
  configPath = join(tempDir, "config.toml");
  const packDir = join(adaptorsDir, "drift-audit");
  mkdirSync(join(packDir, "prompts"), { recursive: true });
  writeFileSync(join(packDir, "manifest.json"), JSON.stringify(WEIGHTLESS_MANIFEST));
  writeFileSync(join(packDir, "prompts", "system.md"), "Output only a JSON array.\n");
  writeFileSync(
    configPath,
    `adaptors_dir = "${adaptorsDir}"\ndefault_model = "/fake/model"\n`,
  );
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("weightless adaptor — info", () => {
  test("lists the pack with its mode", async () => {
    const { stdout, exitCode } = await runCLI(["adaptor", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("drift-audit");
  });

  test("info shows mode and omits LoRA-only fields", async () => {
    const { stdout, exitCode } = await runCLI(["adaptor", "info", "drift-audit"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Mode:        inference-only");
    expect(stdout).not.toContain("LoRA rank:");
    expect(stdout).not.toContain("MLX quant:");
    expect(stdout).not.toContain("Eval pass:");
  });
});

describe("weightless adaptor — generate", () => {
  test("generate with a weightless --adaptor does not error on missing weights/", async () => {
    const { stdout, stderr, exitCode } = await runCLI([
      "generate",
      "Audit decision ADR-017 for drift.",
      "--adaptor",
      "drift-audit",
      "--system",
      join(adaptorsDir, "drift-audit", "prompts", "system.md"),
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Error");
    // dry-run echoes the prompt back
    expect(stdout).toContain("dry-run");
  });
});
