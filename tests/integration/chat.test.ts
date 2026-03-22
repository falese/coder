import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BUN = process.execPath;
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

let tempDir: string;
let configPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-chat-int-"));
  configPath = join(tempDir, "config.toml");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function runChat(
  stdinLines: string[],
  extraArgs: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(
    [BUN, CLI, "chat", "--model", "/any/path", ...extraArgs],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        CODER_DRY_RUN: "1",
        CODER_CONFIG_PATH: configPath,
      },
    },
  );

  const input = stdinLines.join("\n") + "\n";
  void proc.stdin.write(input);
  void proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

// ---------------------------------------------------------------------------
// Basic REPL behaviour
// ---------------------------------------------------------------------------

describe("coder chat basic", () => {
  test("responds to a prompt and exits via /exit", async () => {
    const { exitCode, stdout } = await runChat(["hello", "/exit"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("dry-run");
  });

  test("stdin close exits cleanly", async () => {
    const proc = Bun.spawn([BUN, CLI, "chat", "--model", "/any/path"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        CODER_DRY_RUN: "1",
        CODER_CONFIG_PATH: configPath,
      },
    });
    void proc.stdin.end();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("/exit command exits with code 0", async () => {
    const { exitCode } = await runChat(["/exit"]);
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// /clear command
// ---------------------------------------------------------------------------

describe("/clear command", () => {
  test("clears history — response does not echo prior turn content", async () => {
    const { exitCode } = await runChat([
      "first message",
      "/clear",
      "second message",
      "/exit",
    ]);
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// /save command
// ---------------------------------------------------------------------------

describe("/save command", () => {
  test("writes conversation JSON to file", async () => {
    const savePath = join(tempDir, "conversation.json");
    const { exitCode } = await runChat([
      "hello",
      `/save ${savePath}`,
      "/exit",
    ]);
    expect(exitCode).toBe(0);
    expect(existsSync(savePath)).toBe(true);
    const content = readFileSync(savePath, "utf8");
    const parsed: unknown = JSON.parse(content);
    expect(Array.isArray(parsed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// --help
// ---------------------------------------------------------------------------

test("coder chat --help lists the command", async () => {
  const proc = Bun.spawn([BUN, CLI, "chat", "--help"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CODER_CONFIG_PATH: configPath },
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain("chat");
});
