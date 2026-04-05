import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BUN = process.execPath;
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

let tempDir: string;
let configPath: string;
let logsDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-logs-int-"));
  configPath = join(tempDir, "config.toml");
  logsDir = join(tempDir, "logs");
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(
    configPath,
    `logs_dir = "${logsDir}"\nlog_level = "info"\n`,
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
    env: { ...process.env, CODER_CONFIG_PATH: configPath, ...env },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("coder logs", () => {
  test("streams log file content to stdout", async () => {
    const logLine = JSON.stringify({ ts: "2026-03-21T00:00:00Z", level: "info", msg: "test event" });
    writeFileSync(join(logsDir, "coder.log"), logLine + "\n");

    const { stdout, exitCode } = await runCLI(["logs"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("test event");
  });

  test("exits 0 with informational message when log file does not exist", async () => {
    const { stderr, exitCode } = await runCLI(["logs"]);
    expect(exitCode).toBe(0);
    expect(stderr).toContain("No log file");
  });

  test("logs --help exits 0 and describes the command", async () => {
    const { stdout, exitCode } = await runCLI(["logs", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("log");
  });

  test("--follow streams existing log content and runs until killed", async () => {
    const logLine = JSON.stringify({ ts: "2026-03-21T00:00:00Z", level: "info", msg: "follow event" });
    writeFileSync(join(logsDir, "coder.log"), logLine + "\n");

    const proc = Bun.spawn([BUN, CLI, "logs", "--follow"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, CODER_CONFIG_PATH: configPath },
    });

    // Read from stdout until we see the expected content or hit a timeout.
    // tail -f outputs existing file content immediately before blocking.
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    const deadline = Date.now() + 3000;

    while (Date.now() < deadline) {
      const race = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), 200),
        ),
      ]);
      if (race.done) break;
      output += decoder.decode(race.value);
      if (output.includes("follow event")) break;
    }

    void reader.cancel();
    proc.kill();
    await proc.exited;

    expect(output).toContain("follow event");
  });
});
