import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BUN = process.execPath;
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

let tempDir: string;
let modelsDir: string;
let configPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-models-int-"));
  modelsDir = join(tempDir, "models");
  configPath = join(tempDir, "config.toml");
  mkdirSync(modelsDir, { recursive: true });
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
    env: {
      ...process.env,
      CODER_CONFIG_PATH: configPath,
      CODER_MODELS_DIR: modelsDir,
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

function makeModel(org: string, name: string, bits = 4, modelType = "qwen2") {
  const dir = join(modelsDir, org, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({ model_type: modelType, quantization: { bits } }),
  );
  writeFileSync(join(dir, "model.safetensors"), Buffer.alloc(1024));
  return dir;
}

// ---------------------------------------------------------------------------
// models list
// ---------------------------------------------------------------------------

describe("coder models list", () => {
  test("exits 0 and shows header when no models present", async () => {
    const { stdout, exitCode } = await runCLI(["models", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("NAME");
  });

  test("lists a model with name, quant, and size columns", async () => {
    makeModel("mlx-community", "Qwen2.5-Coder-7B-Instruct-4bit", 4);
    const { stdout, exitCode } = await runCLI(["models", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("mlx-community/Qwen2.5-Coder-7B-Instruct-4bit");
    expect(stdout).toContain("4-bit");
  });

  test("lists multiple models", async () => {
    makeModel("mlx-community", "ModelA", 4);
    makeModel("mlx-community", "ModelB", 8);
    const { stdout, exitCode } = await runCLI(["models", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("ModelA");
    expect(stdout).toContain("ModelB");
  });
});

// ---------------------------------------------------------------------------
// models info
// ---------------------------------------------------------------------------

describe("coder models info", () => {
  test("shows model details for an existing model", async () => {
    makeModel("mlx-community", "Qwen2.5-Coder-7B-Instruct-4bit", 4, "qwen2");
    const { stdout, exitCode } = await runCLI([
      "models",
      "info",
      "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("qwen2");
    expect(stdout).toContain("4-bit");
  });

  test("exits non-zero for unknown model", async () => {
    const { exitCode, stderr } = await runCLI(["models", "info", "org/nonexistent"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// models remove
// ---------------------------------------------------------------------------

describe("coder models remove", () => {
  test("removes an existing model directory", async () => {
    const dir = makeModel("mlx-community", "ToRemove", 4);
    expect(existsSync(dir)).toBe(true);
    const { exitCode } = await runCLI(["models", "remove", "mlx-community/ToRemove"]);
    expect(exitCode).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });

  test("exits non-zero when model does not exist", async () => {
    const { exitCode, stderr } = await runCLI(["models", "remove", "org/ghost"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// models pull (dry-run)
// ---------------------------------------------------------------------------

describe("coder models pull (dry-run)", () => {
  test("dry-run exits 0 and prints intent", async () => {
    const { stdout, stderr, exitCode } = await runCLI(
      ["models", "pull", "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit"],
      { CODER_DRY_RUN: "1" },
    );
    expect(exitCode).toBe(0);
    expect(stdout + stderr).toContain("mlx-community/Qwen2.5-Coder-7B-Instruct-4bit");
  });
});

// ---------------------------------------------------------------------------
// models --help
// ---------------------------------------------------------------------------

describe("coder models --help", () => {
  test("shows subcommands", async () => {
    const { stdout, exitCode } = await runCLI(["models", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("pull");
    expect(stdout).toContain("info");
    expect(stdout).toContain("remove");
  });
});
