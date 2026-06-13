import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BUN = process.execPath;
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

let tempDir: string;
let adaptorsDir: string;
let episodesDir: string;
let configPath: string;

async function runCLI(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([BUN, CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CODER_CONFIG_PATH: configPath, CODER_DRY_RUN: "1" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function writeEpisode(i: number): void {
  const ts = `2026-06-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`;
  const ep = {
    id: `ep${String(i)}`,
    sessionId: `s${String(i)}`,
    startedAt: ts,
    endedAt: ts,
    model: "/models/test",
    turns: [
      { role: "user", content: `question ${String(i)}`, ts },
      {
        role: "assistant",
        content: `answer ${String(i)}\n<threads>{"threads":["concept${String(i)}","shared"]}</threads>`,
        threads: [`concept${String(i)}`, "shared"],
        ts,
      },
    ],
    threads: [`concept${String(i)}`, "shared"],
  };
  writeFileSync(join(episodesDir, `ep${String(i)}.json`), JSON.stringify(ep));
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-persona-it-"));
  adaptorsDir = join(tempDir, "adaptors");
  episodesDir = join(tempDir, "episodes");
  mkdirSync(adaptorsDir, { recursive: true });
  mkdirSync(episodesDir, { recursive: true });
  configPath = join(tempDir, "config.toml");
  writeFileSync(
    configPath,
    `adaptors_dir = "${adaptorsDir}"\nepisodes_dir = "${episodesDir}"\nlogs_dir = "${join(tempDir, "logs")}"\nlog_level = "debug"\n`,
  );
  for (let i = 0; i < 4; i++) writeEpisode(i);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("persona loop (integration, dry-run)", () => {
  test("scaffold → self-improve --persona → eval --persona closes the loop", async () => {
    const scaffold = await runCLI(["adaptor", "scaffold", "persona-me", "--from-episodes"]);
    expect(scaffold.exitCode).toBe(0);

    const packDir = join(adaptorsDir, "persona-me");
    expect(existsSync(join(packDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(packDir, "train-config.toml"))).toBe(true);
    expect(existsSync(join(packDir, "data", "persona-eval.jsonl"))).toBe(true);

    const improve = await runCLI(["adaptor", "self-improve", "persona-me", "--persona", "--rounds", "1"]);
    expect(improve.exitCode).toBe(0);

    const evalRun = await runCLI(["adaptor", "eval", "persona-me", "--persona"]);
    expect(evalRun.exitCode).toBe(0);
    expect(evalRun.stdout).toContain("persona_f1");

    const manifest = JSON.parse(readFileSync(join(packDir, "manifest.json"), "utf-8")) as { persona_f1?: number };
    expect(typeof manifest.persona_f1).toBe("number");
  });
});
