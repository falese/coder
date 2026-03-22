import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  TrainConfigSchema,
  loadTrainConfig,
  generateLoraYaml,
} from "../../src/training/config.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-train-cfg-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const VALID_CONFIG = {
  model: { path: "/tmp/model" },
  lora: {
    rank: 8,
    target_modules: ["q_proj", "v_proj"],
    iters: 1000,
    batch_size: 4,
    learning_rate: 0.0001,
  },
  data: { dir: "./data" },
  output: {
    adaptor_dir: "./weights",
    manifest: "./manifest.json",
    log_file: "./training.log",
  },
};

describe("TrainConfigSchema", () => {
  test("accepts a valid config", () => {
    const result = TrainConfigSchema.safeParse(VALID_CONFIG);
    expect(result.success).toBe(true);
  });

  test("rejects missing model.path", () => {
    const result = TrainConfigSchema.safeParse({
      ...VALID_CONFIG,
      model: {},
    });
    expect(result.success).toBe(false);
  });

  test("rejects non-positive lora rank", () => {
    const result = TrainConfigSchema.safeParse({
      ...VALID_CONFIG,
      lora: { ...VALID_CONFIG.lora, rank: 0 },
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty target_modules", () => {
    const result = TrainConfigSchema.safeParse({
      ...VALID_CONFIG,
      lora: { ...VALID_CONFIG.lora, target_modules: [] },
    });
    expect(result.success).toBe(false);
  });

  test("rejects non-positive iters", () => {
    const result = TrainConfigSchema.safeParse({
      ...VALID_CONFIG,
      lora: { ...VALID_CONFIG.lora, iters: -1 },
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing data.dir", () => {
    const result = TrainConfigSchema.safeParse({
      ...VALID_CONFIG,
      data: {},
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing output.adaptor_dir", () => {
    const result = TrainConfigSchema.safeParse({
      ...VALID_CONFIG,
      output: { ...VALID_CONFIG.output, adaptor_dir: "" },
    });
    expect(result.success).toBe(false);
  });
});

describe("generateLoraYaml", () => {
  test("includes lora_layers: 16 for standard target_modules", () => {
    const config = TrainConfigSchema.parse(VALID_CONFIG);
    const yaml = generateLoraYaml(config);
    expect(yaml).toContain("lora_layers: 16");
  });

  test("includes rank from config", () => {
    const config = TrainConfigSchema.parse(VALID_CONFIG);
    const yaml = generateLoraYaml(config);
    expect(yaml).toContain("rank: 8");
  });

  test("sets alpha to rank * 2", () => {
    const config = TrainConfigSchema.parse(VALID_CONFIG);
    const yaml = generateLoraYaml(config);
    expect(yaml).toContain("alpha: 16");
  });

  test("includes dropout: 0.0 and scale: 10.0", () => {
    const config = TrainConfigSchema.parse(VALID_CONFIG);
    const yaml = generateLoraYaml(config);
    expect(yaml).toContain("dropout: 0.0");
    expect(yaml).toContain("scale: 10.0");
  });

  test("uses different rank value when config changes", () => {
    const config = TrainConfigSchema.parse({
      ...VALID_CONFIG,
      lora: { ...VALID_CONFIG.lora, rank: 16 },
    });
    const yaml = generateLoraYaml(config);
    expect(yaml).toContain("rank: 16");
    expect(yaml).toContain("alpha: 32");
  });
});

describe("loadTrainConfig", () => {
  test("loads and parses a valid TOML config file", () => {
    const toml = `
[model]
path = "/tmp/model"

[lora]
rank = 8
target_modules = ["q_proj", "v_proj"]
iters = 1000
batch_size = 4
learning_rate = 1e-4

[data]
dir = "./data"

[output]
adaptor_dir = "./weights"
manifest = "./manifest.json"
log_file = "./training.log"
`;
    const configFile = join(tempDir, "train.toml");
    writeFileSync(configFile, toml);

    const config = loadTrainConfig(configFile);
    expect(config.model.path).toBe("/tmp/model");
    expect(config.lora.rank).toBe(8);
    expect(config.lora.target_modules).toEqual(["q_proj", "v_proj"]);
    expect(config.lora.iters).toBe(1000);
    expect(config.data.dir).toBe("./data");
  });

  test("expands ~ in model.path", () => {
    const toml = `
[model]
path = "~/.coder/models/Qwen2.5"

[lora]
rank = 8
target_modules = ["q_proj", "v_proj"]
iters = 100
batch_size = 4
learning_rate = 1e-4

[data]
dir = "./data"

[output]
adaptor_dir = "./weights"
manifest = "./manifest.json"
log_file = "./training.log"
`;
    const configFile = join(tempDir, "train.toml");
    writeFileSync(configFile, toml);

    const config = loadTrainConfig(configFile);
    expect(config.model.path).not.toContain("~");
    expect(config.model.path).toContain(".coder/models/Qwen2.5");
  });

  test("throws on non-existent config file", () => {
    expect(() => loadTrainConfig("/nonexistent/path.toml")).toThrow();
  });

  test("throws on invalid TOML content", () => {
    const configFile = join(tempDir, "bad.toml");
    writeFileSync(configFile, "not = valid = toml [[[");
    expect(() => loadTrainConfig(configFile)).toThrow();
  });

  test("throws with descriptive error on schema violation", () => {
    const configFile = join(tempDir, "bad-schema.toml");
    writeFileSync(configFile, "[model]\npath = \"\"\n");
    expect(() => loadTrainConfig(configFile)).toThrow();
  });
});
