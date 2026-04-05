import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BUN = process.execPath;
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

let tempDir: string;
let adaptorsDir: string;
let configPath: string;
let bareRepoPath: string;

const VALID_MANIFEST = {
  name: "react-ts",
  version: "1.0.0",
  domain: "frontend",
  base_model: "Qwen2.5-Coder-7B",
  mlx_quant: "4bit",
  lora_rank: 8,
  min_memory_gb: 18,
  eval_pass_rate: 0.85,
  author: "test",
  description: "A test adaptor",
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

async function initBareRepo(sourceDir: string): Promise<string> {
  const bareDir = join(tempDir, "bare-repo.git");

  // Init source repo
  const init = Bun.spawn(["git", "init", sourceDir], { stdout: "pipe", stderr: "pipe" });
  await init.exited;

  const configUser = Bun.spawn(
    ["git", "-C", sourceDir, "config", "user.email", "test@test.com"],
    { stdout: "pipe", stderr: "pipe" },
  );
  await configUser.exited;

  const configName = Bun.spawn(
    ["git", "-C", sourceDir, "config", "user.name", "Test"],
    { stdout: "pipe", stderr: "pipe" },
  );
  await configName.exited;

  const add = Bun.spawn(["git", "-C", sourceDir, "add", "."], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await add.exited;

  const commit = Bun.spawn(
    ["git", "-C", sourceDir, "commit", "-m", "init"],
    { stdout: "pipe", stderr: "pipe" },
  );
  await commit.exited;

  // Clone as bare
  const clone = Bun.spawn(["git", "clone", "--bare", sourceDir, bareDir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await clone.exited;

  return bareDir;
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-adaptor-int-"));
  adaptorsDir = join(tempDir, "adaptors");
  configPath = join(tempDir, "config.toml");
  mkdirSync(adaptorsDir, { recursive: true });

  // Write config pointing to our temp adaptors dir
  writeFileSync(configPath, `adaptors_dir = "${adaptorsDir}"\n`);

  // Build a local bare git repo fixture with a valid adaptor structure
  const sourceDir = join(tempDir, "source-adaptor");
  mkdirSync(join(sourceDir, "data"), { recursive: true });
  writeFileSync(join(sourceDir, "manifest.json"), JSON.stringify(VALID_MANIFEST));
  writeFileSync(
    join(sourceDir, "data", "eval.jsonl"),
    JSON.stringify({ prompt: "write a debounce function", completion: "export function debounce() {}" }) + "\n",
  );

  bareRepoPath = await initBareRepo(sourceDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// coder adaptor list
// ---------------------------------------------------------------------------

describe("coder adaptor list", () => {
  test("prints header and empty state when no adaptors installed", async () => {
    const { stdout, exitCode } = await runCLI(["adaptor", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("NAME");
  });
});

// ---------------------------------------------------------------------------
// coder adaptor install
// ---------------------------------------------------------------------------

describe("coder adaptor install", () => {
  test("installs adaptor from local bare repo", async () => {
    const url = `file://${bareRepoPath}`;
    const { exitCode, stderr } = await runCLI(
      ["adaptor", "install", "react-ts", "--from-git", url],
      { CODER_DRY_RUN: "" },
    );
    expect(exitCode).toBe(0);
    expect(existsSync(join(adaptorsDir, "react-ts", "manifest.json"))).toBe(true);
    expect(stderr).not.toContain("Error");
  });

  test("exits 1 for invalid git URL", async () => {
    const { exitCode } = await runCLI(
      ["adaptor", "install", "bad", "--from-git", "file:///nonexistent/path"],
      { CODER_DRY_RUN: "" },
    );
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// coder adaptor info
// ---------------------------------------------------------------------------

describe("coder adaptor info", () => {
  test("shows manifest fields after install", async () => {
    const url = `file://${bareRepoPath}`;
    await runCLI(["adaptor", "install", "react-ts", "--from-git", url], {
      CODER_DRY_RUN: "",
    });

    const { stdout, exitCode } = await runCLI(["adaptor", "info", "react-ts"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("react-ts");
    expect(stdout).toContain("1.0.0");
  });

  test("exits 1 when adaptor not installed", async () => {
    const { exitCode } = await runCLI(["adaptor", "info", "nonexistent"]);
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// coder adaptor update
// ---------------------------------------------------------------------------

describe("coder adaptor update", () => {
  test("exits 0 when already up to date", async () => {
    const url = `file://${bareRepoPath}`;
    await runCLI(["adaptor", "install", "react-ts", "--from-git", url], {
      CODER_DRY_RUN: "",
    });

    const { exitCode } = await runCLI(["adaptor", "update", "react-ts"], {
      CODER_DRY_RUN: "",
    });
    expect(exitCode).toBe(0);
  });

  test("exits 1 when adaptor not installed", async () => {
    const { exitCode } = await runCLI(["adaptor", "update", "nonexistent"], {
      CODER_DRY_RUN: "",
    });
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// coder adaptor remove
// ---------------------------------------------------------------------------

describe("coder adaptor remove", () => {
  test("removes installed adaptor", async () => {
    const url = `file://${bareRepoPath}`;
    await runCLI(["adaptor", "install", "react-ts", "--from-git", url], {
      CODER_DRY_RUN: "",
    });

    const { exitCode } = await runCLI(["adaptor", "remove", "react-ts"]);
    expect(exitCode).toBe(0);
    expect(existsSync(join(adaptorsDir, "react-ts"))).toBe(false);
  });

  test("exits 1 when adaptor not installed", async () => {
    const { exitCode } = await runCLI(["adaptor", "remove", "nonexistent"]);
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// coder adaptor --help
// ---------------------------------------------------------------------------

test("coder adaptor --help lists subcommands", async () => {
  const { stdout, exitCode } = await runCLI(["adaptor", "--help"]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain("list");
  expect(stdout).toContain("install");
  expect(stdout).toContain("update");
  expect(stdout).toContain("info");
  expect(stdout).toContain("remove");
  expect(stdout).toContain("train");
});

// ---------------------------------------------------------------------------
// coder adaptor train
// ---------------------------------------------------------------------------

describe("coder adaptor train", () => {
  function writeTrainConfig(dir: string, configPath: string): void {
    const toml = `
[model]
path = "${dir}/model"

[lora]
rank = 8
target_modules = ["q_proj", "v_proj"]
iters = 100
batch_size = 4
learning_rate = 1e-4

[data]
dir = "${dir}/data"

[output]
adaptor_dir = "${dir}/weights"
manifest = "${dir}/manifest.json"
log_file = "${dir}/training.log"
`;
    writeFileSync(configPath, toml);
  }

  test("dry-run exits 0 and writes stub adapters.safetensors", async () => {
    const configPath = join(tempDir, "train.toml");
    writeTrainConfig(tempDir, configPath);
    mkdirSync(join(tempDir, "weights"), { recursive: true });

    const { exitCode, stdout } = await runCLI([
      "adaptor",
      "train",
      "--config",
      configPath,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Training complete.");
    expect(existsSync(join(tempDir, "weights", "adapters.safetensors"))).toBe(true);
  });

  test("exits 1 when --config flag is missing", async () => {
    const { exitCode } = await runCLI(["adaptor", "train"]);
    expect(exitCode).not.toBe(0);
  });

  test("exits 1 when config file does not exist", async () => {
    const { exitCode, stderr } = await runCLI([
      "adaptor",
      "train",
      "--config",
      "/nonexistent/train.toml",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error:");
  });

  test("exits 1 when config file has invalid schema", async () => {
    const configPath = join(tempDir, "bad.toml");
    writeFileSync(configPath, "[model]\npath = \"\"\n");

    const { exitCode, stderr } = await runCLI([
      "adaptor",
      "train",
      "--config",
      configPath,
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error:");
  });
});

// ---------------------------------------------------------------------------
// coder adaptor eval
// ---------------------------------------------------------------------------

describe("coder adaptor eval", () => {
  test("dry-run exits 0 with table output", async () => {
    const url = `file://${bareRepoPath}`;
    await runCLI(["adaptor", "install", "react-ts", "--from-git", url], {
      CODER_DRY_RUN: "",
    });

    const { exitCode, stdout } = await runCLI([
      "adaptor",
      "eval",
      "react-ts",
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("COMPOSITE");
    expect(stdout).toContain("MEAN");
    expect(stdout).toContain("eval_pass_rate");
  });

  test("--baseline writes baseline_pass_rate", async () => {
    const url = `file://${bareRepoPath}`;
    await runCLI(["adaptor", "install", "react-ts", "--from-git", url], {
      CODER_DRY_RUN: "",
    });

    const { exitCode, stdout } = await runCLI([
      "adaptor",
      "eval",
      "react-ts",
      "--baseline",
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("baseline_pass_rate");
  });

  test("exits 1 when adaptor not installed", async () => {
    const { exitCode, stderr } = await runCLI(["adaptor", "eval", "nonexistent"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error:");
  });
});

// ---------------------------------------------------------------------------
// coder adaptor self-improve
// ---------------------------------------------------------------------------

describe("coder adaptor self-improve", () => {
  test("dry-run exits 0 and prints final score", async () => {
    const url = `file://${bareRepoPath}`;
    await runCLI(["adaptor", "install", "react-ts", "--from-git", url], {
      CODER_DRY_RUN: "",
    });

    const { exitCode, stdout } = await runCLI(
      ["adaptor", "self-improve", "react-ts", "--rounds", "1", "--samples", "1"],
      { CODER_DRY_RUN: "1" },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Self-improvement complete.");
  });

  test("exits 1 when adaptor not installed", async () => {
    const { exitCode, stderr } = await runCLI([
      "adaptor",
      "self-improve",
      "nonexistent",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error:");
  });
});
