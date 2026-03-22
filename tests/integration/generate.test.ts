import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "path";
import { tmpdir } from "node:os";

const BUN = process.execPath;
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-gen-test-"));
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
      CODER_CONFIG_PATH: join(tempDir, "config.toml"),
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

describe("generate command integration", () => {
  test("dry-run generates output and exits 0", async () => {
    const { stdout, exitCode } = await runCLI(
      ["generate", "write a bubble sort", "--model", "/models/test"],
      { CODER_DRY_RUN: "1" },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# dry-run: write a bubble sort");
  });

  test("exits non-zero when --model is missing", async () => {
    const { exitCode, stderr } = await runCLI(["generate", "write a bubble sort"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--model");
  });

  test("generate --help exits 0 and shows --model", async () => {
    const { stdout, exitCode } = await runCLI(["generate", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--model");
  });

  test("--help shows coder usage", async () => {
    const { stdout, exitCode } = await runCLI(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("coder");
  });
});
