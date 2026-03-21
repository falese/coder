import { describe, test, expect } from "bun:test";
import { join } from "path";

const BUN = process.execPath;
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

async function runCLI(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([BUN, CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
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
