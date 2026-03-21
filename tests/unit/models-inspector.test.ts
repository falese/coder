import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  estimateMemoryGb,
  parseModelConfig,
  getModelEntry,
  listModels,
} from "../../src/models/inspector.js";

// ---------------------------------------------------------------------------
// Temp directory harness
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-models-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// estimateMemoryGb — pure function
// ---------------------------------------------------------------------------

describe("estimateMemoryGb", () => {
  test("4-bit 7B model estimates ~4.2 GB", () => {
    const gb = estimateMemoryGb(7_000_000_000, 4);
    expect(gb).toBeCloseTo(4.2, 1);
  });

  test("8-bit 7B model estimates ~8.4 GB", () => {
    const gb = estimateMemoryGb(7_000_000_000, 8);
    expect(gb).toBeCloseTo(8.4, 1);
  });

  test("16-bit 7B model estimates ~16.8 GB", () => {
    const gb = estimateMemoryGb(7_000_000_000, 16);
    expect(gb).toBeCloseTo(16.8, 1);
  });
});

// ---------------------------------------------------------------------------
// parseModelConfig
// ---------------------------------------------------------------------------

describe("parseModelConfig", () => {
  test("returns null when config.json is missing", () => {
    const modelDir = join(tempDir, "empty-model");
    mkdirSync(modelDir);
    expect(parseModelConfig(modelDir)).toBeNull();
  });

  test("parses model_type and quantization bits", () => {
    const modelDir = join(tempDir, "qwen-model");
    mkdirSync(modelDir);
    writeFileSync(
      join(modelDir, "config.json"),
      JSON.stringify({
        model_type: "qwen2",
        quantization: { bits: 4, group_size: 64 },
      }),
    );
    const config = parseModelConfig(modelDir);
    expect(config?.model_type).toBe("qwen2");
    expect(config?.quantization?.bits).toBe(4);
  });

  test("returns null for malformed JSON", () => {
    const modelDir = join(tempDir, "bad-model");
    mkdirSync(modelDir);
    writeFileSync(join(modelDir, "config.json"), "not json {{{");
    expect(parseModelConfig(modelDir)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getModelEntry
// ---------------------------------------------------------------------------

describe("getModelEntry", () => {
  test("returns entry with correct name and path", () => {
    const modelDir = join(tempDir, "test-model");
    mkdirSync(modelDir);
    writeFileSync(
      join(modelDir, "config.json"),
      JSON.stringify({ model_type: "qwen2", quantization: { bits: 4 } }),
    );

    const entry = getModelEntry("org/test-model", modelDir);
    expect(entry.name).toBe("org/test-model");
    expect(entry.path).toBe(modelDir);
  });

  test("uses quantBits from config.json", () => {
    const modelDir = join(tempDir, "4bit-model");
    mkdirSync(modelDir);
    writeFileSync(
      join(modelDir, "config.json"),
      JSON.stringify({ model_type: "qwen2", quantization: { bits: 4 } }),
    );

    const entry = getModelEntry("org/4bit-model", modelDir);
    expect(entry.quantBits).toBe(4);
  });

  test("defaults quantBits to 16 when not specified in config", () => {
    const modelDir = join(tempDir, "fp16-model");
    mkdirSync(modelDir);
    writeFileSync(
      join(modelDir, "config.json"),
      JSON.stringify({ model_type: "llama" }),
    );

    const entry = getModelEntry("org/fp16-model", modelDir);
    expect(entry.quantBits).toBe(16);
  });

  test("computes memoryEstimateGb from safetensors size and quant bits", () => {
    const modelDir = join(tempDir, "weight-model");
    mkdirSync(modelDir);
    writeFileSync(
      join(modelDir, "config.json"),
      JSON.stringify({ model_type: "qwen2", quantization: { bits: 4 } }),
    );
    // Write a fake 100-byte safetensors file
    writeFileSync(join(modelDir, "model.safetensors"), Buffer.alloc(100));

    const entry = getModelEntry("org/weight-model", modelDir);
    // 100 bytes at 4-bit → 200 params → 200 * 0.5 * 1.2 = 120 bytes = 1.2e-7 GB
    expect(entry.memoryEstimateGb).toBeCloseTo(1.2e-7, 15);
  });

  test("diskSizeBytes includes all files in model dir", () => {
    const modelDir = join(tempDir, "sized-model");
    mkdirSync(modelDir);
    writeFileSync(join(modelDir, "config.json"), JSON.stringify({}));
    writeFileSync(join(modelDir, "model.safetensors"), Buffer.alloc(1000));

    const entry = getModelEntry("org/sized-model", modelDir);
    expect(entry.diskSizeBytes).toBeGreaterThan(1000);
  });

  test("modelType is unknown when config.json is absent", () => {
    const modelDir = join(tempDir, "no-config-model");
    mkdirSync(modelDir);

    const entry = getModelEntry("org/no-config-model", modelDir);
    expect(entry.modelType).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// listModels
// ---------------------------------------------------------------------------

describe("listModels", () => {
  test("returns empty array when models_dir does not exist", () => {
    expect(listModels(join(tempDir, "nonexistent"))).toEqual([]);
  });

  test("returns empty array when models_dir has no model subdirs", () => {
    const modelsDir = join(tempDir, "models");
    mkdirSync(modelsDir);
    expect(listModels(modelsDir)).toEqual([]);
  });

  test("finds models nested under org/name structure", () => {
    const modelsDir = join(tempDir, "models");
    const orgDir = join(modelsDir, "mlx-community");
    const modelDir = join(orgDir, "Qwen2.5-Coder-7B-Instruct-4bit");
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(
      join(modelDir, "config.json"),
      JSON.stringify({ model_type: "qwen2", quantization: { bits: 4 } }),
    );

    const entries = listModels(modelsDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("mlx-community/Qwen2.5-Coder-7B-Instruct-4bit");
  });

  test("ignores org directories that contain no config.json model", () => {
    const modelsDir = join(tempDir, "models");
    const orgDir = join(modelsDir, "mlx-community");
    const emptyDir = join(orgDir, "not-a-model");
    mkdirSync(emptyDir, { recursive: true });

    const entries = listModels(modelsDir);
    expect(entries).toHaveLength(0);
  });

  test("lists multiple models from the same org", () => {
    const modelsDir = join(tempDir, "models");
    const orgDir = join(modelsDir, "mlx-community");

    for (const name of ["ModelA", "ModelB"]) {
      const dir = join(orgDir, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "config.json"), JSON.stringify({ model_type: "llama" }));
    }

    const entries = listModels(modelsDir);
    expect(entries).toHaveLength(2);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["mlx-community/ModelA", "mlx-community/ModelB"]);
  });
});
