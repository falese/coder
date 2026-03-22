import { readFileSync, rmSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { ManifestSchema } from "./types.js";
import type { AdaptorManifest, AdaptorEntry } from "./types.js";

export type { AdaptorManifest, AdaptorEntry };

export function readManifest(adaptorDir: string): AdaptorManifest {
  const raw = readFileSync(join(adaptorDir, "manifest.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  return ManifestSchema.parse(parsed);
}

export function listAdaptors(adaptorsDir: string): AdaptorEntry[] {
  if (!existsSync(adaptorsDir)) return [];

  const entries: AdaptorEntry[] = [];
  for (const entry of readdirSync(adaptorsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const adaptorDir = join(adaptorsDir, entry.name);
    const manifestPath = join(adaptorDir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = readManifest(adaptorDir);
      entries.push({ name: entry.name, path: adaptorDir, manifest });
    } catch {
      // skip invalid manifests
    }
  }
  return entries;
}

export function removeAdaptor(name: string, adaptorsDir: string): void {
  const adaptorDir = join(adaptorsDir, name);
  if (!existsSync(adaptorDir)) {
    throw new Error(`Adaptor "${name}" not found`);
  }
  rmSync(adaptorDir, { recursive: true, force: true });
}

async function runGit(args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `git exited with code ${String(exitCode)}`);
  }
}

export async function installAdaptor(
  name: string,
  url: string,
  adaptorsDir: string,
): Promise<void> {
  const destDir = join(adaptorsDir, name);
  await runGit(["clone", url, destDir]);
  try {
    readManifest(destDir);
  } catch (e) {
    rmSync(destDir, { recursive: true, force: true });
    throw e;
  }
}

export async function updateAdaptor(name: string, adaptorsDir: string): Promise<void> {
  const adaptorDir = join(adaptorsDir, name);
  if (!existsSync(adaptorDir) || !statSync(adaptorDir).isDirectory()) {
    throw new Error(`Adaptor "${name}" not found`);
  }
  await runGit(["-C", adaptorDir, "pull"]);
}
