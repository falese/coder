import { statSync, readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
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
  let scanDir = baseDir;
  let scanPattern = pattern;

  if (isAbsolute(pattern)) {
    const firstGlob = pattern.search(/[*?[{]/);
    const dirPart = firstGlob === -1 ? pattern : pattern.slice(0, pattern.lastIndexOf("/", firstGlob));
    scanDir = dirPart || "/";
    scanPattern = firstGlob === -1 ? "*" : pattern.slice(scanDir.length + 1);
  }

  const glob = new Bun.Glob(scanPattern);
  const files = Array.from(
    glob.scanSync({ cwd: scanDir, onlyFiles: true }),
  );

  const records: JsonlRecord[] = [];

  for (const file of files) {
    const absPath = join(scanDir, file);
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
