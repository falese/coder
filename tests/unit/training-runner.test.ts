import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  spyOn,
  mock,
} from "bun:test";
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
import {
  parseLossLine,
  bumpPatchVersion,
  buildTrainArgs,
  updateManifestVersion,
  runMlxTrain,
} from "../../src/training/runner.js";
import { markPreflightDoneForTest } from "../../src/inference/mlx-runner.js";
import type { TrainConfig } from "../../src/training/config.js";

let tempDir: string;

function makeConfig(overrides: Partial<TrainConfig> = {}): TrainConfig {
  return {
    model: { path: join(tempDir, "model") },
    lora: {
      rank: 8,
      target_modules: ["q_proj", "v_proj"],
      iters: 100,
      batch_size: 4,
      learning_rate: 0.0001,
    },
    data: { dir: join(tempDir, "data") },
    output: {
      adaptor_dir: join(tempDir, "weights"),
      manifest: join(tempDir, "manifest.json"),
      log_file: join(tempDir, "training.log"),
    },
    ...overrides,
  };
}

function makeStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      if (text) controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-runner-test-"));
  markPreflightDoneForTest();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  mock.restore();
});

describe("parseLossLine", () => {
  test("parses a standard loss line", () => {
    const result = parseLossLine("Iter 100: train loss 0.423");
    expect(result).toEqual({ iter: 100, loss: 0.423 });
  });

  test("parses with variable whitespace", () => {
    const result = parseLossLine("Iter  50:  train loss  1.234");
    expect(result).toEqual({ iter: 50, loss: 1.234 });
  });

  test("returns null for non-loss lines", () => {
    expect(parseLossLine("Loading model weights")).toBeNull();
    expect(parseLossLine("Epoch 1")).toBeNull();
    expect(parseLossLine("")).toBeNull();
  });

  test("returns null for validation loss lines (train loss only)", () => {
    // mlx_lm also emits "val loss" lines — we only want "train loss"
    const result = parseLossLine("Iter 100: val loss 0.500");
    expect(result).toBeNull();
  });
});

describe("bumpPatchVersion", () => {
  test("increments the patch version", () => {
    expect(bumpPatchVersion("1.0.0")).toBe("1.0.1");
    expect(bumpPatchVersion("1.2.3")).toBe("1.2.4");
    expect(bumpPatchVersion("0.0.0")).toBe("0.0.1");
  });

  test("does not touch major or minor", () => {
    expect(bumpPatchVersion("2.5.9")).toBe("2.5.10");
  });
});

describe("buildTrainArgs", () => {
  test("includes required mlx_lm lora flags", () => {
    const config = makeConfig();
    const args = buildTrainArgs(config, "/tmp/lora.yaml");

    expect(args).toContain("python3");
    expect(args).toContain("-m");
    expect(args).toContain("mlx_lm.lora");
    expect(args).toContain("--train");
    expect(args).toContain("--model");
    expect(args).toContain("--data");
    expect(args).toContain("--iters");
    expect(args).toContain("--batch-size");
    expect(args).toContain("--learning-rate");
    expect(args).toContain("--adapter-path");
    expect(args).toContain("--mask-prompt");
    expect(args).toContain("--grad-checkpoint");
    expect(args).toContain("-c");
    expect(args).toContain("/tmp/lora.yaml");
  });

  test("does not include --resume-adapter-file when no checkpoint exists", () => {
    const config = makeConfig();
    const args = buildTrainArgs(config, "/tmp/lora.yaml");
    expect(args).not.toContain("--resume-adapter-file");
  });

  test("includes --resume-adapter-file when adaptor.safetensors exists", () => {
    const config = makeConfig();
    mkdirSync(config.output.adaptor_dir, { recursive: true });
    writeFileSync(join(config.output.adaptor_dir, "adaptor.safetensors"), "stub");

    const args = buildTrainArgs(config, "/tmp/lora.yaml");
    expect(args).toContain("--resume-adapter-file");
    expect(args).toContain(join(config.output.adaptor_dir, "adaptor.safetensors"));
  });

  test("passes correct values from config", () => {
    const config = makeConfig();
    const args = buildTrainArgs(config, "/tmp/lora.yaml");

    const idxModel = args.indexOf("--model");
    expect(args[idxModel + 1]).toBe(config.model.path);

    const idxData = args.indexOf("--data");
    expect(args[idxData + 1]).toBe(config.data.dir);

    const idxIters = args.indexOf("--iters");
    expect(args[idxIters + 1]).toBe(String(config.lora.iters));
  });
});

describe("updateManifestVersion", () => {
  test("bumps patch version in manifest.json", () => {
    const manifestPath = join(tempDir, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({ name: "test-adaptor", version: "1.0.0", eval_pass_rate: 0.0 }),
    );

    updateManifestVersion(manifestPath);

    const updated = JSON.parse(readFileSync(manifestPath, "utf-8")) as { version: string };
    expect(updated.version).toBe("1.0.1");
  });

  test("preserves other manifest fields", () => {
    const manifestPath = join(tempDir, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({ name: "react-ts", version: "2.1.3", eval_pass_rate: 0.85 }),
    );

    updateManifestVersion(manifestPath);

    const updated = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      name: string;
      version: string;
      eval_pass_rate: number;
    };
    expect(updated.name).toBe("react-ts");
    expect(updated.eval_pass_rate).toBe(0.85);
    expect(updated.version).toBe("2.1.4");
  });

  test("does nothing if manifest file does not exist", () => {
    // Should not throw
    expect(() => updateManifestVersion(join(tempDir, "missing.json"))).not.toThrow();
  });
});

describe("runMlxTrain — dry-run", () => {
  test("dry-run writes stub adaptor.safetensors and exits without spawning", async () => {
    const config = makeConfig();
    mkdirSync(config.output.adaptor_dir, { recursive: true });

    const spawnSpy = spyOn(Bun, "spawn");

    await runMlxTrain(config, true);

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(existsSync(join(config.output.adaptor_dir, "adaptor.safetensors"))).toBe(true);
  });
});

describe("runMlxTrain — real spawn (mocked)", () => {
  test("spawns with correct args and streams stdout", async () => {
    const config = makeConfig();
    mkdirSync(config.output.adaptor_dir, { recursive: true });
    mkdirSync(config.data.dir, { recursive: true });

    const stdout =
      "Loading model...\nIter 10: train loss 0.800\nIter 20: train loss 0.650\nDone\n";

    const mockProc = {
      stdout: makeStream(stdout),
      stderr: makeStream(""),
      exited: Promise.resolve(0),
    };

    spyOn(Bun, "spawn").mockReturnValue(mockProc as ReturnType<typeof Bun.spawn>);

    await runMlxTrain(config, false);

    // Training log should contain the parsed loss lines
    expect(existsSync(config.output.log_file)).toBe(true);
    const logContent = readFileSync(config.output.log_file, "utf-8");
    const lines = logContent.trim().split("\n").filter(Boolean);
    const events = lines.map((l) => JSON.parse(l) as { event: string; iter: number; loss: number });
    const stepEvents = events.filter((e) => e.event === "training_step");
    expect(stepEvents).toHaveLength(2);
    expect(stepEvents[0]).toMatchObject({ iter: 10, loss: 0.8 });
    expect(stepEvents[1]).toMatchObject({ iter: 20, loss: 0.65 });
  });

  test("throws on non-zero exit code", async () => {
    const config = makeConfig();
    mkdirSync(config.output.adaptor_dir, { recursive: true });

    const mockProc = {
      stdout: makeStream(""),
      stderr: makeStream("CUDA out of memory"),
      exited: Promise.resolve(1),
    };

    spyOn(Bun, "spawn").mockReturnValue(mockProc as ReturnType<typeof Bun.spawn>);

    let threw = false;
    try {
      await runMlxTrain(config, false);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
