import {
  describe,
  test,
  expect,
  mock,
  spyOn,
  beforeEach,
  afterEach,
} from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSelfImprove } from "../../src/adaptors/self-improve.js";
import type { EvalSummary } from "../../src/eval/runner.js";
import type { SampleResult } from "../../src/inference/sampler.js";
import { logger, resetLoggerForTest } from "../../src/observability/logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvalSummary(meanComposite: number): EvalSummary {
  return {
    records: [],
    meanTsc: meanComposite,
    meanEslint: meanComposite,
    meanTests: meanComposite,
    meanComposite,
  };
}

function makeEvalSummaryWithRecord(prompt: string, composite: number): EvalSummary {
  return {
    records: [
      {
        prompt,
        composite,
        scores: { tsc: composite, eslint: composite, tests: composite },
        generatedCode: "",
        diagnostics: { tsc: "", eslint: "", tests: "" },
      },
    ],
    meanTsc: composite,
    meanEslint: composite,
    meanTests: composite,
    meanComposite: composite,
  };
}

function makeAdaptorDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "coder-ssd-test-"));
  mkdirSync(join(dir, "data"), { recursive: true });
  mkdirSync(join(dir, "weights"), { recursive: true });
  writeFileSync(
    join(dir, "data", "eval.jsonl"),
    JSON.stringify({ prompt: "// write a button", completion: "const x = 1;" }) + "\n",
  );
  writeFileSync(
    join(dir, "data", "train.jsonl"),
    JSON.stringify({ prompt: "// existing", completion: "const y = 2;" }) + "\n",
  );
  writeFileSync(join(dir, "weights", "adapters.safetensors"), "stub\n");
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      name: "test", version: "1.0.0", domain: "test", base_model: "test-model",
      mlx_quant: "4bit", lora_rank: 8, min_memory_gb: 18,
      eval_pass_rate: 0.8, author: "", description: "",
    }) + "\n",
  );
  return dir;
}

const PASSING_SAMPLE: SampleResult = {
  prompt: "// write a button",
  completion: "const x = 1;",
  composite: 0.9,
};

const FAILING_SAMPLE: SampleResult = {
  prompt: "// write a button",
  completion: "bad code",
  composite: 0.3,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runSelfImprove", () => {
  let adaptorDir: string;
  let tempLogDir: string;

  beforeEach(() => {
    adaptorDir = makeAdaptorDir();
    // Isolate logger from real ~/.coder/logs — redirect to a temp dir
    tempLogDir = mkdtempSync(join(tmpdir(), "coder-test-logs-"));
    const configPath = join(tempLogDir, "config.toml");
    writeFileSync(configPath, `logs_dir = "${tempLogDir}"\nlog_level = "info"\n`);
    process.env.CODER_CONFIG_PATH = configPath;
    resetLoggerForTest();
  });

  afterEach(() => {
    delete process.env.CODER_CONFIG_PATH;
    resetLoggerForTest();
    rmSync(adaptorDir, { recursive: true, force: true });
    rmSync(tempLogDir, { recursive: true, force: true });
  });

  test("commit path: scoreAfter > scoreBefore → committed: true, .bak deleted", async () => {
    let evalCallCount = 0;
    const mockEval = mock(() => {
      evalCallCount++;
      return Promise.resolve(makeEvalSummary(evalCallCount === 1 ? 0.7 : 0.9));
    });
    const mockSample = mock(() => Promise.resolve([PASSING_SAMPLE]));
    const mockTrain = mock(() => Promise.resolve(undefined));

    const results = await runSelfImprove(
      { adaptorDir, modelPath: "/models/test", rounds: 1, samplesPerPrompt: 1, threshold: 0.7, temperature: 0.7, dryRun: false },
      { evalFn: mockEval, sampleFn: mockSample, trainFn: mockTrain },
    );

    expect(results).toHaveLength(1);
    expect(results[0].committed).toBe(true);
    expect(results[0].scoreBefore).toBeCloseTo(0.7);
    expect(results[0].scoreAfter).toBeCloseTo(0.9);
    expect(results[0].filtered).toBe(1);
    expect(existsSync(join(adaptorDir, "weights", "adapters.safetensors.bak"))).toBe(false);
  });

  test("rollback path: scoreAfter < scoreBefore → committed: false, checkpoint restored", async () => {
    const originalContent = readFileSync(
      join(adaptorDir, "weights", "adapters.safetensors"),
      "utf-8",
    );
    let evalCallCount = 0;
    const mockEval = mock(() => {
      evalCallCount++;
      return Promise.resolve(makeEvalSummary(evalCallCount === 1 ? 0.9 : 0.7));
    });
    const mockSample = mock(() => Promise.resolve([PASSING_SAMPLE]));
    const mockTrain = mock(() => {
      // Simulate training overwriting checkpoint
      writeFileSync(join(adaptorDir, "weights", "adapters.safetensors"), "trained\n");
      return Promise.resolve(undefined);
    });

    const results = await runSelfImprove(
      { adaptorDir, modelPath: "/models/test", rounds: 1, samplesPerPrompt: 1, threshold: 0.7, temperature: 0.7, dryRun: false },
      { evalFn: mockEval, sampleFn: mockSample, trainFn: mockTrain },
    );

    expect(results[0].committed).toBe(false);
    expect(results[0].scoreBefore).toBeCloseTo(0.9);
    expect(results[0].scoreAfter).toBeCloseTo(0.7);
    const restoredContent = readFileSync(
      join(adaptorDir, "weights", "adapters.safetensors"),
      "utf-8",
    );
    expect(restoredContent).toBe(originalContent);
    expect(existsSync(join(adaptorDir, "weights", "adapters.safetensors.bak"))).toBe(false);
  });

  test("zero passing samples: skip training, committed: false, filtered: 0", async () => {
    const mockEval = mock(() => Promise.resolve(makeEvalSummary(0.8)));
    const mockSample = mock(() => Promise.resolve([FAILING_SAMPLE]));
    const mockTrain = mock(() => Promise.resolve(undefined));

    const results = await runSelfImprove(
      { adaptorDir, modelPath: "/models/test", rounds: 1, samplesPerPrompt: 1, threshold: 0.7, temperature: 0.7, dryRun: false },
      { evalFn: mockEval, sampleFn: mockSample, trainFn: mockTrain },
    );

    expect(results[0].committed).toBe(false);
    expect(results[0].filtered).toBe(0);
    expect(results[0].generated).toBe(1);
    expect(mockTrain).not.toHaveBeenCalled();
  });

  test("result array length equals opts.rounds", async () => {
    const mockEval = mock(() => Promise.resolve(makeEvalSummary(0.8)));
    const mockSample = mock(() => Promise.resolve([FAILING_SAMPLE]));
    const mockTrain = mock(() => Promise.resolve(undefined));

    const results = await runSelfImprove(
      { adaptorDir, modelPath: "/models/test", rounds: 3, samplesPerPrompt: 1, threshold: 0.7, temperature: 0.7, dryRun: false },
      { evalFn: mockEval, sampleFn: mockSample, trainFn: mockTrain },
    );

    expect(results).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(results[i].round).toBe(i + 1);
    }
  });

  test("adaptive temperature resolves to 0.7 for sampleFn", async () => {
    const mockEval = mock(() => Promise.resolve(makeEvalSummary(0.8)));
    const capturedTemps: number[] = [];
    const mockSample = mock((_prompts: unknown, _k: unknown, temp: number) => {
      capturedTemps.push(temp);
      return Promise.resolve([FAILING_SAMPLE]);
    });
    const mockTrain = mock(() => Promise.resolve(undefined));

    await runSelfImprove(
      { adaptorDir, modelPath: "/models/test", rounds: 1, samplesPerPrompt: 1, threshold: 0.7, temperature: "adaptive", dryRun: false },
      { evalFn: mockEval, sampleFn: mockSample, trainFn: mockTrain },
    );

    expect(capturedTemps[0]).toBe(0.7);
  });

  test("adaptive temp: mastered prompt (composite >= 0.9) uses temperature 0.3", async () => {
    const PROMPT = "// write a button";
    const capturedTemps: number[] = [];
    const mockEval = mock(() =>
      Promise.resolve(makeEvalSummaryWithRecord(PROMPT, 0.95)),
    );
    const mockSample = mock((_prompts: unknown, _k: unknown, temp: number) => {
      capturedTemps.push(temp);
      return Promise.resolve([FAILING_SAMPLE]);
    });
    const mockTrain = mock(() => Promise.resolve(undefined));

    await runSelfImprove(
      { adaptorDir, modelPath: "/models/test", rounds: 1, samplesPerPrompt: 1, threshold: 0.7, temperature: "adaptive", dryRun: false },
      { evalFn: mockEval, sampleFn: mockSample, trainFn: mockTrain },
    );

    expect(capturedTemps[0]).toBe(0.3);
  });

  test("adaptive temp: failing prompt (composite < 0.5) uses temperature 1.0", async () => {
    const PROMPT = "// write a button";
    const capturedTemps: number[] = [];
    const mockEval = mock(() =>
      Promise.resolve(makeEvalSummaryWithRecord(PROMPT, 0.3)),
    );
    const mockSample = mock((_prompts: unknown, _k: unknown, temp: number) => {
      capturedTemps.push(temp);
      return Promise.resolve([FAILING_SAMPLE]);
    });
    const mockTrain = mock(() => Promise.resolve(undefined));

    await runSelfImprove(
      { adaptorDir, modelPath: "/models/test", rounds: 1, samplesPerPrompt: 1, threshold: 0.7, temperature: "adaptive", dryRun: false },
      { evalFn: mockEval, sampleFn: mockSample, trainFn: mockTrain },
    );

    expect(capturedTemps[0]).toBe(1.0);
  });

  test("fixed temperature disables adaptive: always uses the given number", async () => {
    const PROMPT = "// write a button";
    const capturedTemps: number[] = [];
    // Baseline composite is 0.95 (mastered) — adaptive would give 0.3, but fixed should override
    const mockEval = mock(() =>
      Promise.resolve(makeEvalSummaryWithRecord(PROMPT, 0.95)),
    );
    const mockSample = mock((_prompts: unknown, _k: unknown, temp: number) => {
      capturedTemps.push(temp);
      return Promise.resolve([FAILING_SAMPLE]);
    });
    const mockTrain = mock(() => Promise.resolve(undefined));

    await runSelfImprove(
      { adaptorDir, modelPath: "/models/test", rounds: 1, samplesPerPrompt: 1, threshold: 0.7, temperature: 0.5, dryRun: false },
      { evalFn: mockEval, sampleFn: mockSample, trainFn: mockTrain },
    );

    expect(capturedTemps[0]).toBe(0.5);
  });

  test("manifest history fields written after run", async () => {
    let evalCallCount = 0;
    const mockEval = mock(() => {
      evalCallCount++;
      return Promise.resolve(
        makeEvalSummaryWithRecord("// write a button", evalCallCount === 1 ? 0.7 : 0.9),
      );
    });
    const mockSample = mock(() => Promise.resolve([PASSING_SAMPLE]));
    const mockTrain = mock(() => Promise.resolve(undefined));

    await runSelfImprove(
      { adaptorDir, modelPath: "/models/test", rounds: 1, samplesPerPrompt: 1, threshold: 0.7, temperature: 0.7, dryRun: false },
      { evalFn: mockEval, sampleFn: mockSample, trainFn: mockTrain },
    );

    const manifest = JSON.parse(readFileSync(join(adaptorDir, "manifest.json"), "utf-8")) as Record<string, unknown>;
    expect(manifest.self_improve_rounds).toBe(1);
    expect(Array.isArray(manifest.self_improve_score_history)).toBe(true);
    expect(typeof manifest.self_improve_last_run).toBe("string");
  });

  test("self_improve_complete log event is emitted", async () => {
    const logSpy = spyOn(logger, "logEvent").mockImplementation(() => {});

    const mockEval = mock(() => Promise.resolve(makeEvalSummary(0.8)));
    const mockSample = mock(() => Promise.resolve([FAILING_SAMPLE]));
    const mockTrain = mock(() => Promise.resolve(undefined));

    try {
      await runSelfImprove(
        { adaptorDir, modelPath: "/models/test", rounds: 1, samplesPerPrompt: 1, threshold: 0.7, temperature: 0.7, dryRun: false },
        { evalFn: mockEval, sampleFn: mockSample, trainFn: mockTrain },
      );

      const emittedEvents = logSpy.mock.calls.map(([e]) => e.event);
      expect(emittedEvents).toContain("self_improve_complete");
    } finally {
      logSpy.mockRestore();
    }
  });

  test("dryRun: true skips training and never writes to weights dir", async () => {
    const originalContent = readFileSync(
      join(adaptorDir, "weights", "adapters.safetensors"),
      "utf-8",
    );
    const mockEval = mock(() => Promise.resolve(makeEvalSummary(0.8)));
    const mockSample = mock(() => Promise.resolve([PASSING_SAMPLE]));
    const mockTrain = mock(() => Promise.resolve(undefined));

    const results = await runSelfImprove(
      { adaptorDir, modelPath: "/models/test", rounds: 1, samplesPerPrompt: 1, threshold: 0.7, temperature: 0.7, dryRun: true },
      { evalFn: mockEval, sampleFn: mockSample, trainFn: mockTrain },
    );

    expect(mockTrain).not.toHaveBeenCalled();
    expect(results[0].committed).toBe(false);
    const afterContent = readFileSync(
      join(adaptorDir, "weights", "adapters.safetensors"),
      "utf-8",
    );
    expect(afterContent).toBe(originalContent);
  });

  test("self_improve_complete final_score reflects active weights, not last rejected score", async () => {
    const logSpy = spyOn(logger, "logEvent").mockImplementation(() => {});

    // scoreBefore=0.9, scoreAfter=0.7 → rolled back → active score stays 0.9
    let evalCallCount = 0;
    const mockEval = mock(() => {
      evalCallCount++;
      return Promise.resolve(
        makeEvalSummaryWithRecord("// write a button", evalCallCount === 1 ? 0.9 : 0.7),
      );
    });
    const mockSample = mock(() => Promise.resolve([PASSING_SAMPLE]));
    const mockTrain = mock(() => {
      writeFileSync(join(adaptorDir, "weights", "adapters.safetensors"), "trained\n");
      return Promise.resolve(undefined);
    });

    try {
      await runSelfImprove(
        { adaptorDir, modelPath: "/models/test", rounds: 1, samplesPerPrompt: 1, threshold: 0.7, temperature: 0.7, dryRun: false },
        { evalFn: mockEval, sampleFn: mockSample, trainFn: mockTrain },
      );

      const completeCall = logSpy.mock.calls.find(([e]) => e.event === "self_improve_complete");
      expect(completeCall).toBeDefined();
      // Active weights are still at scoreBefore (0.9), not the rejected scoreAfter (0.7)
      const payload = completeCall?.[0] as { final_score: number } | undefined;
      expect(payload?.final_score).toBeCloseTo(0.9);
    } finally {
      logSpy.mockRestore();
    }
  });

  test("manifest version bumped by number of committed rounds", async () => {
    let evalCallCount = 0;
    const mockEval = mock(() => {
      evalCallCount++;
      return Promise.resolve(
        makeEvalSummaryWithRecord("// write a button", evalCallCount === 1 ? 0.7 : 0.9),
      );
    });
    const mockSample = mock(() => Promise.resolve([PASSING_SAMPLE]));
    const mockTrain = mock(() => Promise.resolve(undefined));

    await runSelfImprove(
      { adaptorDir, modelPath: "/models/test", rounds: 1, samplesPerPrompt: 1, threshold: 0.7, temperature: 0.7, dryRun: false },
      { evalFn: mockEval, sampleFn: mockSample, trainFn: mockTrain },
    );

    const manifest = JSON.parse(readFileSync(join(adaptorDir, "manifest.json"), "utf-8")) as Record<string, unknown>;
    expect(manifest.version).toBe("1.0.1");
  });
});
