import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDataPromptsCommand } from "../../src/commands/data-prompts.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PromptEntry {
  prompt: string;
  ts: string;
  adaptor_version?: string;
}

function makeEntry(prompt: string, ts: string, version?: string): PromptEntry {
  return { prompt, ts, ...(version ? { adaptor_version: version } : {}) };
}

let tempDir: string;
let adaptorDir: string;
let logFile: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-prompts-test-"));
  adaptorDir = join(tempDir, "adaptors", "react-ts");
  mkdirSync(join(adaptorDir, "data"), { recursive: true });
  logFile = join(adaptorDir, "data", "prompt-log.jsonl");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeLog(entries: PromptEntry[]): void {
  writeFileSync(logFile, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

function readLog(): PromptEntry[] {
  return readFileSync(logFile, "utf-8")
    .trim()
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as PromptEntry);
}

// Run a subcommand action by invoking it via the command tree
async function runCmd(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let exitCode = 0;

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origExit = process.exit.bind(process);

  process.stdout.write = (chunk: string | Uint8Array) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  process.stderr.write = (chunk: string | Uint8Array) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  (process as NodeJS.Process & { exit: (code?: number) => never }).exit = (code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${String(exitCode)})`);
  };

  try {
    const cmd = createDataPromptsCommand(join(tempDir, "adaptors"));
    await cmd.parseAsync(args, { from: "user" });
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith("process.exit")) throw e;
  } finally {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    (process as NodeJS.Process & { exit: (code?: number) => never }).exit = origExit;
  }

  return {
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("coder data prompts list", () => {
  test("prints entries with timestamp and truncated prompt", async () => {
    writeLog([
      makeEntry("write a MUI Button component", "2026-04-05T10:00:00.000Z"),
      makeEntry("add a themed TextField with error state", "2026-04-05T11:00:00.000Z"),
    ]);

    const { stdout } = await runCmd(["list", "--adaptor", "react-ts"]);
    expect(stdout).toContain("2026-04-05T10:00:00.000Z");
    expect(stdout).toContain("write a MUI Button component");
    expect(stdout).toContain("2026-04-05T11:00:00.000Z");
    expect(stdout).toContain("add a themed TextField");
  });

  test("truncates prompts longer than 80 chars", async () => {
    const longPrompt = "x".repeat(100);
    writeLog([makeEntry(longPrompt, "2026-04-05T10:00:00.000Z")]);

    const { stdout } = await runCmd(["list", "--adaptor", "react-ts"]);
    // Should not contain the full 100-char prompt
    expect(stdout).not.toContain(longPrompt);
    // Should contain first 80 chars
    expect(stdout).toContain("x".repeat(80));
  });

  test("exits 1 with error when prompt-log is absent", async () => {
    const { exitCode, stderr } = await runCmd(["list", "--adaptor", "react-ts"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("prompt-log.jsonl");
  });
});

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

describe("coder data prompts stats", () => {
  test("reports total, unique, and token distribution", async () => {
    writeLog([
      makeEntry("a".repeat(80), "2026-04-05T10:00:00.000Z"),   // 20 tokens
      makeEntry("b".repeat(200), "2026-04-05T11:00:00.000Z"),  // 50 tokens
      makeEntry("a".repeat(80), "2026-04-05T12:00:00.000Z"),   // duplicate of first
    ]);

    const { stdout } = await runCmd(["stats", "--adaptor", "react-ts"]);
    expect(stdout).toContain("Total prompts:   3");
    expect(stdout).toContain("Unique prompts:  2");
    expect(stdout).toMatch(/min=\d+/);
    expect(stdout).toMatch(/p50=\d+/);
    expect(stdout).toMatch(/p95=\d+/);
    expect(stdout).toMatch(/max=\d+/);
  });

  test("exits 1 with error when prompt-log is absent", async () => {
    const { exitCode, stderr } = await runCmd(["stats", "--adaptor", "react-ts"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("prompt-log.jsonl");
  });
});

// ---------------------------------------------------------------------------
// deduplicate
// ---------------------------------------------------------------------------

describe("coder data prompts deduplicate", () => {
  test("removes exact duplicates in-place and reports count", async () => {
    writeLog([
      makeEntry("write a button", "2026-04-05T10:00:00.000Z"),
      makeEntry("write a button", "2026-04-05T11:00:00.000Z"), // duplicate
      makeEntry("add a select", "2026-04-05T12:00:00.000Z"),
    ]);

    const { stderr } = await runCmd(["deduplicate", "--adaptor", "react-ts"]);
    expect(stderr).toContain("Removed 1 duplicate");
    expect(stderr).toContain("2 remaining");

    const remaining = readLog();
    expect(remaining).toHaveLength(2);
    expect(remaining[0].prompt).toBe("write a button");
    expect(remaining[1].prompt).toBe("add a select");
  });

  test("reports 0 removed when no duplicates", async () => {
    writeLog([
      makeEntry("write a button", "2026-04-05T10:00:00.000Z"),
      makeEntry("add a select", "2026-04-05T11:00:00.000Z"),
    ]);

    const { stderr } = await runCmd(["deduplicate", "--adaptor", "react-ts"]);
    expect(stderr).toContain("Removed 0 duplicate");
    expect(stderr).toContain("2 remaining");
  });

  test("preserves first occurrence when deduplicating", async () => {
    writeLog([
      makeEntry("write a button", "2026-04-05T10:00:00.000Z", "1.0.0"),
      makeEntry("write a button", "2026-04-05T11:00:00.000Z", "1.0.1"),
    ]);

    await runCmd(["deduplicate", "--adaptor", "react-ts"]);

    const remaining = readLog();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].adaptor_version).toBe("1.0.0"); // first occurrence kept
  });
});

// ---------------------------------------------------------------------------
// purge
// ---------------------------------------------------------------------------

describe("coder data prompts purge", () => {
  test("--before without --confirm prints dry-run summary and does not modify file", async () => {
    writeLog([
      makeEntry("old prompt", "2026-01-01T00:00:00.000Z"),
      makeEntry("new prompt", "2026-04-05T00:00:00.000Z"),
    ]);

    const { stdout, exitCode } = await runCmd([
      "purge", "--adaptor", "react-ts", "--before", "2026-03-01T00:00:00.000Z",
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Would remove 1");
    expect(stdout).toContain("--confirm");
    // File unchanged
    expect(readLog()).toHaveLength(2);
  });

  test("--before --confirm removes entries older than date", async () => {
    writeLog([
      makeEntry("old prompt", "2026-01-01T00:00:00.000Z"),
      makeEntry("new prompt", "2026-04-05T00:00:00.000Z"),
    ]);

    const { stderr } = await runCmd([
      "purge", "--adaptor", "react-ts", "--before", "2026-03-01T00:00:00.000Z", "--confirm",
    ]);

    expect(stderr).toContain("Removed 1");
    const remaining = readLog();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].prompt).toBe("new prompt");
  });

  test("--below-tokens --confirm removes short entries", async () => {
    writeLog([
      makeEntry("hi", "2026-04-05T10:00:00.000Z"),                   // ~0.5 tokens
      makeEntry("a".repeat(200), "2026-04-05T11:00:00.000Z"),        // 50 tokens
    ]);

    const { stderr } = await runCmd([
      "purge", "--adaptor", "react-ts", "--below-tokens", "10", "--confirm",
    ]);

    expect(stderr).toContain("Removed 1");
    const remaining = readLog();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].prompt).toBe("a".repeat(200));
  });

  test("--before and --below-tokens combined --confirm applies both filters", async () => {
    writeLog([
      makeEntry("hi", "2026-01-01T00:00:00.000Z"),                   // old AND short
      makeEntry("old but long " + "x".repeat(100), "2026-01-01T00:00:00.000Z"),  // old
      makeEntry("new but short", "2026-04-05T00:00:00.000Z"),        // short
      makeEntry("a".repeat(200), "2026-04-05T11:00:00.000Z"),        // keep
    ]);

    const { stderr } = await runCmd([
      "purge", "--adaptor", "react-ts",
      "--before", "2026-03-01T00:00:00.000Z",
      "--below-tokens", "10",
      "--confirm",
    ]);

    expect(stderr).toContain("Removed 3");
    const remaining = readLog();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].prompt).toBe("a".repeat(200));
  });
});
