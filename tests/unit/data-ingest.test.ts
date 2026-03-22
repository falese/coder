import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ingestFiles } from "../../src/data/ingest.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-ingest-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("ingestFiles", () => {
  test("returns one record per text file", () => {
    writeFileSync(join(tempDir, "a.ts"), "const x = 1;");
    writeFileSync(join(tempDir, "b.ts"), "const y = 2;");

    const records = ingestFiles("*.ts", tempDir);
    expect(records).toHaveLength(2);
  });

  test("record prompt is the relative file path", () => {
    writeFileSync(join(tempDir, "hello.ts"), "export function hello() {}");

    const records = ingestFiles("*.ts", tempDir);
    expect(records[0].prompt).toBe("hello.ts");
  });

  test("record completion is the file contents", () => {
    const content = "export function greet(name: string) { return name; }";
    writeFileSync(join(tempDir, "greet.ts"), content);

    const records = ingestFiles("*.ts", tempDir);
    expect(records[0].completion).toBe(content);
  });

  test("skips files larger than 100 KB", () => {
    const big = "x".repeat(101 * 1024);
    writeFileSync(join(tempDir, "big.ts"), big);

    const records = ingestFiles("*.ts", tempDir);
    expect(records).toHaveLength(0);
  });

  test("skips binary files (null bytes in first 512 bytes)", () => {
    const buf = Buffer.alloc(100);
    buf[10] = 0; // null byte
    writeFileSync(join(tempDir, "binary.ts"), buf);

    const records = ingestFiles("*.ts", tempDir);
    expect(records).toHaveLength(0);
  });

  test("includes normal text file alongside skipped files", () => {
    writeFileSync(join(tempDir, "normal.ts"), "const a = 1;");
    const big = "x".repeat(101 * 1024);
    writeFileSync(join(tempDir, "big.ts"), big);

    const records = ingestFiles("*.ts", tempDir);
    expect(records).toHaveLength(1);
    expect(records[0].prompt).toBe("normal.ts");
  });

  test("returns empty array when no files match glob", () => {
    const records = ingestFiles("*.ts", tempDir);
    expect(records).toHaveLength(0);
  });

  test("works with subdirectory glob pattern", () => {
    mkdirSync(join(tempDir, "src"));
    writeFileSync(join(tempDir, "src", "foo.ts"), "const foo = 1;");

    const records = ingestFiles("src/*.ts", tempDir);
    expect(records).toHaveLength(1);
    expect(records[0].prompt).toBe("src/foo.ts");
  });
});
