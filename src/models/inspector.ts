import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ModelConfig, ModelEntry } from "./types.js";

export function estimateMemoryGb(numParams: number, quantBits: number): number {
  const bytesPerWeight = quantBits / 8;
  return (numParams * bytesPerWeight * 1.2) / 1e9;
}

export function parseModelConfig(modelDir: string): ModelConfig | null {
  const configPath = join(modelDir, "config.json");
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as ModelConfig;
  } catch {
    return null;
  }
}

function getDirSizeBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += getDirSizeBytes(p);
    } else {
      total += statSync(p).size;
    }
  }
  return total;
}

function getSafetensorsSizeBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".safetensors")) {
      total += statSync(join(dir, entry.name)).size;
    }
  }
  return total;
}

export function getModelEntry(name: string, modelDir: string): ModelEntry {
  const config = parseModelConfig(modelDir);
  const quantBits = config?.quantization?.bits ?? 16;
  const safetensorsBytes = getSafetensorsSizeBytes(modelDir);
  const diskSizeBytes = getDirSizeBytes(modelDir);

  const bytesPerWeight = quantBits / 8;
  const numParams = safetensorsBytes > 0 ? safetensorsBytes / bytesPerWeight : 0;

  return {
    name,
    path: modelDir,
    modelType: config?.model_type ?? "unknown",
    quantBits,
    diskSizeBytes,
    memoryEstimateGb: estimateMemoryGb(numParams, quantBits),
  };
}

export function listModels(modelsDir: string): ModelEntry[] {
  if (!existsSync(modelsDir)) return [];
  const entries: ModelEntry[] = [];

  for (const orgEntry of readdirSync(modelsDir, { withFileTypes: true })) {
    if (!orgEntry.isDirectory()) continue;
    const orgDir = join(modelsDir, orgEntry.name);

    for (const modelEntry of readdirSync(orgDir, { withFileTypes: true })) {
      if (!modelEntry.isDirectory()) continue;
      const modelDir = join(orgDir, modelEntry.name);
      if (existsSync(join(modelDir, "config.json"))) {
        entries.push(getModelEntry(`${orgEntry.name}/${modelEntry.name}`, modelDir));
      }
    }
  }

  return entries;
}
