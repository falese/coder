import { statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonlRecord } from "./types.js";

const MAX_BYTES = 100 * 1024;

function isBinary(buf: Buffer): boolean {
  const limit = Math.min(512, buf.length);
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export function ingestFiles(
  pattern: string,
  baseDir: string = process.cwd(),
): JsonlRecord[] {
  const glob = new Bun.Glob(pattern);
  const files = Array.from(
    glob.scanSync({ cwd: baseDir, onlyFiles: true }),
  );

  const records: JsonlRecord[] = [];

  for (const file of files) {
    const absPath = join(baseDir, file);
    const stat = statSync(absPath);
    if (stat.size > MAX_BYTES) continue;

    const buf = readFileSync(absPath);
    if (isBinary(buf)) continue;

    records.push({
      prompt: file,
      completion: buf.toString("utf-8"),
    });
  }

  return records;
}
