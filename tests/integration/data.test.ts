import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BUN = process.execPath;
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

let tempDir: string;
let configPath: string;

const VALID_RECORD = JSON.stringify({ prompt: "write a fn", completion: "function foo() {}" });
const VALID_JSONL = VALID_RECORD + "\n" + JSON.stringify({ prompt: "sort", completion: "arr.sort()" }) + "\n";

async function runCLI(
  args: string[],
  env: Record<string, string> = {},
  stdin?: string,
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([BUN, CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: stdin !== undefined ? new TextEncoder().encode(stdin) : "ignore",
    cwd: cwd,
    env: {
      ...process.env,
      CODER_CONFIG_PATH: configPath,
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
  tempDir = mkdtempSync(join(tmpdir(), "coder-data-int-test-"));
  configPath = join(tempDir, "config.toml");
  writeFileSync(
    configPath,
    `default_model = ""\nadaptors_dir = "${tempDir}/adaptors"\nmodels_dir = "${tempDir}/models"\nlogs_dir = "${tempDir}/logs"\nlog_level = "info"\n`,
  );
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("coder data ingest", () => {
  test("ingests .ts files and prints JSONL to stdout", async () => {
    const srcDir = join(tempDir, "src");
    mkdirSync(srcDir);
    writeFileSync(join(srcDir, "foo.ts"), "const x = 1;");

    const { stdout, exitCode } = await runCLI(
      ["data", "ingest", "src/*.ts"],
      {},
      undefined,
      tempDir,
    );

    expect(exitCode).toBe(0);
    const records = stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { prompt: string; completion: string });
    expect(records).toHaveLength(1);
    expect(records[0].prompt).toBe("src/foo.ts");
    expect(records[0].completion).toBe("const x = 1;");
  });

  test("writes to --output file when specified", async () => {
    const srcDir = join(tempDir, "src");
    mkdirSync(srcDir);
    writeFileSync(join(srcDir, "bar.ts"), "const y = 2;");
    const outFile = join(tempDir, "out.jsonl");

    const { exitCode, stderr } = await runCLI(
      ["data", "ingest", "src/*.ts", "-o", outFile],
      {},
      undefined,
      tempDir,
    );

    expect(exitCode).toBe(0);
    expect(existsSync(outFile)).toBe(true);
    expect(stderr).toContain("Ingested");
  });
});

describe("coder data deduplicate", () => {
  test("removes exact duplicates and reports count", async () => {
    const inputFile = join(tempDir, "input.jsonl");
    const dupRecord = JSON.stringify({ prompt: "p", completion: "c" });
    writeFileSync(inputFile, dupRecord + "\n" + dupRecord + "\n");

    const { stdout, stderr, exitCode } = await runCLI([
      "data",
      "deduplicate",
      inputFile,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain("Removed 1");
    const records = stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { prompt: string; completion: string });
    expect(records).toHaveLength(1);
  });

  test("writes deduped output to --output file", async () => {
    const inputFile = join(tempDir, "input.jsonl");
    writeFileSync(inputFile, VALID_JSONL);
    const outFile = join(tempDir, "deduped.jsonl");

    const { exitCode } = await runCLI([
      "data",
      "deduplicate",
      inputFile,
      "-o",
      outFile,
    ]);

    expect(exitCode).toBe(0);
    expect(existsSync(outFile)).toBe(true);
  });
});

describe("coder data validate", () => {
  test("exits 0 for valid JSONL file", async () => {
    const inputFile = join(tempDir, "valid.jsonl");
    writeFileSync(inputFile, VALID_JSONL);

    const { exitCode, stdout } = await runCLI(["data", "validate", inputFile]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Invalid: 0");
  });

  test("exits 1 for JSONL with invalid records", async () => {
    const inputFile = join(tempDir, "bad.jsonl");
    writeFileSync(inputFile, '{"prompt":"","completion":"fn() {}"}\n');

    const { exitCode, stdout } = await runCLI(["data", "validate", inputFile]);

    expect(exitCode).toBe(1);
    expect(stdout).toContain("Invalid: 1");
    expect(stdout).toContain("Invalid lines: 1");
  });
});

describe("coder data split", () => {
  test("with --output-dir writes train.jsonl and valid.jsonl (no basename prefix)", async () => {
    const inputFile = join(tempDir, "data.jsonl");
    const outDir = join(tempDir, "out");
    mkdirSync(outDir);
    const records = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ prompt: `p${String(i)}`, completion: `c${String(i)}` }),
    );
    writeFileSync(inputFile, records.join("\n") + "\n");

    const { exitCode, stderr } = await runCLI([
      "data", "split", inputFile, "--output-dir", outDir,
    ]);

    expect(exitCode).toBe(0);
    expect(existsSync(join(outDir, "train.jsonl"))).toBe(true);
    expect(existsSync(join(outDir, "valid.jsonl"))).toBe(true);
    expect(existsSync(join(outDir, "data.train.jsonl"))).toBe(false);
    expect(stderr).toContain("Train:");
    expect(stderr).toContain("Eval:");
  });

  test("without --output-dir preserves basename prefix alongside input file", async () => {
    const inputFile = join(tempDir, "mydata.jsonl");
    const records = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ prompt: `p${String(i)}`, completion: `c${String(i)}` }),
    );
    writeFileSync(inputFile, records.join("\n") + "\n");

    const { exitCode } = await runCLI(["data", "split", inputFile]);

    expect(exitCode).toBe(0);
    expect(existsSync(join(tempDir, "mydata.train.jsonl"))).toBe(true);
    expect(existsSync(join(tempDir, "mydata.valid.jsonl"))).toBe(true);
  });

  test("respects --train-ratio flag", async () => {
    const inputFile = join(tempDir, "data.jsonl");
    const outDir = join(tempDir, "out2");
    mkdirSync(outDir);
    const records = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ prompt: `p${String(i)}`, completion: `c${String(i)}` }),
    );
    writeFileSync(inputFile, records.join("\n") + "\n");

    await runCLI([
      "data", "split", inputFile, "--train-ratio", "0.8", "--output-dir", outDir,
    ]);

    const trainRecords = readFileSync(join(outDir, "train.jsonl"), "utf-8")
      .trim().split("\n").filter(Boolean);
    const evalRecords = readFileSync(join(outDir, "valid.jsonl"), "utf-8")
      .trim().split("\n").filter(Boolean);

    expect(trainRecords).toHaveLength(8);
    expect(evalRecords).toHaveLength(2);
  });
});

describe("coder data split --min-tokens", () => {
  test("drops records below threshold and reports count", async () => {
    const inputFile = join(tempDir, "mixed.jsonl");
    // short record: ~5 tokens; long record: well above 128 tokens
    const short = JSON.stringify({ prompt: "hi", completion: "x" });
    const long = JSON.stringify({ prompt: "p".repeat(300), completion: "c".repeat(300) });
    writeFileSync(inputFile, short + "\n" + long + "\n");
    const outDir = join(tempDir, "split-min");
    mkdirSync(outDir);

    const { exitCode, stderr } = await runCLI([
      "data", "split", inputFile, "--output-dir", outDir, "--min-tokens", "128",
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain("Dropped 1");
    const train = readFileSync(join(outDir, "train.jsonl"), "utf-8").trim().split("\n").filter(Boolean);
    const valid = readFileSync(join(outDir, "valid.jsonl"), "utf-8").trim().split("\n").filter(Boolean);
    expect(train.length + valid.length).toBe(1);
  });

  test("drops nothing when all records are above threshold", async () => {
    const inputFile = join(tempDir, "all-long.jsonl");
    const long = JSON.stringify({ prompt: "p".repeat(300), completion: "c".repeat(300) });
    writeFileSync(inputFile, long + "\n" + long + "\n");
    const outDir = join(tempDir, "split-min2");
    mkdirSync(outDir);

    const { exitCode, stderr } = await runCLI([
      "data", "split", inputFile, "--output-dir", outDir, "--min-tokens", "128",
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Dropped");
  });
});

describe("coder data validate --min-tokens", () => {
  test("warns about short records but exits 0", async () => {
    const inputFile = join(tempDir, "short.jsonl");
    writeFileSync(inputFile, JSON.stringify({ prompt: "hi", completion: "x" }) + "\n");

    const { exitCode, stderr } = await runCLI([
      "data", "validate", inputFile, "--min-tokens", "128",
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain("Warning:");
    expect(stderr).toContain("1 record");
  });
});

describe("coder data stats", () => {
  test("prints record count and token stats", async () => {
    const inputFile = join(tempDir, "data.jsonl");
    writeFileSync(inputFile, VALID_JSONL);

    const { exitCode, stdout } = await runCLI(["data", "stats", inputFile]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Records:     2");
    expect(stdout).toContain("Prompt tokens");
    expect(stdout).toContain("Duplicate rate:");
  });
});

describe("coder data extract", () => {
  test("extracts prompt/completion pairs using adaptor extract.json", async () => {
    // Set up a fake adaptor with extract.json
    const adaptorDir = join(tempDir, "adaptors", "test-adaptor");
    mkdirSync(adaptorDir, { recursive: true });
    writeFileSync(
      join(adaptorDir, "extract.json"),
      JSON.stringify({
        rules: [{ prompt: "jsdoc", completion: "next_function" }],
      }),
    );

    // Write an input JSONL file
    const src = "/** Adds numbers */\nfunction add(a: number, b: number) {\n  return a + b;\n}\n";
    const inputFile = join(tempDir, "input.jsonl");
    writeFileSync(inputFile, JSON.stringify({ prompt: "add.ts", completion: src }) + "\n");

    const outFile = join(tempDir, "extracted.jsonl");
    const { exitCode } = await runCLI([
      "data",
      "extract",
      "--adaptor",
      "test-adaptor",
      "--input",
      inputFile,
      "-o",
      outFile,
    ]);

    expect(exitCode).toBe(0);
    expect(existsSync(outFile)).toBe(true);
    const extracted = readFileSync(outFile, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { prompt: string; completion: string });
    expect(extracted.length).toBeGreaterThan(0);
    expect(extracted[0].prompt).toContain("Adds numbers");
  });

  test("exits 1 when extract.json is missing", async () => {
    const adaptorDir = join(tempDir, "adaptors", "no-extract");
    mkdirSync(adaptorDir, { recursive: true });
    // No extract.json written

    const { exitCode, stderr } = await runCLI([
      "data",
      "extract",
      "--adaptor",
      "no-extract",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
  });
});
