import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BUN = process.execPath;
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

let tempDir: string;
let configPath: string;
let logsDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-gen-stream-"));
  logsDir = join(tempDir, "logs");
  configPath = join(tempDir, "config.toml");
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(
    configPath,
    `logs_dir = "${logsDir}"\nlog_level = "debug"\n`,
  );
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

describe("generate new flags (dry-run)", () => {
  test("--stream flag is accepted and exits 0", async () => {
    const { exitCode } = await runCLI([
      "generate", "write a test", "--model", "/models/test", "--stream",
    ]);
    expect(exitCode).toBe(0);
  });

  test("-o writes output to a file", async () => {
    const outFile = join(tempDir, "output.txt");
    const { exitCode } = await runCLI([
      "generate", "write a sort", "--model", "/models/test", "-o", outFile,
    ]);
    expect(exitCode).toBe(0);
    expect(existsSync(outFile)).toBe(true);
    expect(readFileSync(outFile, "utf8")).toContain("dry-run");
  });

  test("--output writes output to a file (long form)", async () => {
    const outFile = join(tempDir, "output2.txt");
    const { exitCode } = await runCLI([
      "generate", "hello", "--model", "/models/test", "--output", outFile,
    ]);
    expect(exitCode).toBe(0);
    expect(existsSync(outFile)).toBe(true);
  });

  test("--context prepends file content with separator", async () => {
    const ctxFile = join(tempDir, "ctx.ts");
    writeFileSync(ctxFile, "export const x = 1;");
    const { stdout, exitCode } = await runCLI([
      "generate", "write a test", "--model", "/models/test",
      "--context", ctxFile,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--- context:");
    expect(stdout).toContain("ctx.ts");
  });

  test("--context can be supplied multiple times", async () => {
    const ctx1 = join(tempDir, "a.ts");
    const ctx2 = join(tempDir, "b.ts");
    writeFileSync(ctx1, "const a = 1;");
    writeFileSync(ctx2, "const b = 2;");
    const { stdout, exitCode } = await runCLI([
      "generate", "write a test", "--model", "/models/test",
      "--context", ctx1, "--context", ctx2,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("a.ts");
    expect(stdout).toContain("b.ts");
  });

  test("--system flag is accepted and exits 0", async () => {
    const sysFile = join(tempDir, "system.md");
    writeFileSync(sysFile, "You are a TypeScript expert.");
    const { exitCode } = await runCLI([
      "generate", "write a test", "--model", "/models/test",
      "--system", sysFile,
    ]);
    expect(exitCode).toBe(0);
  });

  test("--adaptor flag is accepted and exits 0", async () => {
    const { exitCode } = await runCLI([
      "generate", "write a test", "--model", "/models/test",
      "--adaptor", "react-ts",
    ]);
    expect(exitCode).toBe(0);
  });
});

describe("generate logging events", () => {
  test("emits generation_start and generation_complete to log file", async () => {
    await runCLI([
      "generate", "write a test", "--model", "/models/test",
    ]);

    const logPath = join(logsDir, "coder.log");
    expect(existsSync(logPath)).toBe(true);

    const lines = readFileSync(logPath, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as { event?: string });

    const events = lines.map((l) => l.event).filter(Boolean);
    expect(events).toContain("generation_start");
    expect(events).toContain("generation_complete");
  });
});
