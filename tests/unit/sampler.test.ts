import { describe, test, expect, spyOn, beforeEach } from "bun:test";
import { sampleCompletions } from "../../src/inference/sampler.js";
import { markPreflightDoneForTest } from "../../src/inference/mlx-runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      if (text) controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function makeMockProcess(stdout: string, stderr: string, exitCode: number) {
  return {
    stdout: makeStream(stdout),
    stderr: makeStream(stderr),
    exited: Promise.resolve(exitCode),
  };
}

// MLX generate output in the format parseMlxOutput expects.
// All Bun.spawn calls (MLX, TSC, ESLint) return exit 0 — the scorers only
// check exit code, so this works for all subprocess types.
const MLX_OUTPUT =
  "==========\nconst x = 1;\n==========\n" +
  "Prompt: 5 tokens, Generation: 20.0 tokens/sec\n";

// mockSpawn creates a fresh stream for every call, avoiding "ReadableStream
// already used" errors when multiple spawns are made per test.
function mockSpawn() {
  return spyOn(Bun, "spawn").mockImplementation(
    (() => makeMockProcess(MLX_OUTPUT, "", 0)) as unknown as typeof Bun.spawn,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sampleCompletions", () => {
  beforeEach(() => {
    markPreflightDoneForTest();
  });

  test("returns prompts.length × k results", async () => {
    const spy = mockSpawn();
    try {
      const results = await sampleCompletions(
        ["prompt one", "prompt two"],
        3,
        0.7,
        { model: "/models/test" },
        { adaptorDir: "/tmp/adaptor-no-evals" },
      );
      expect(results).toHaveLength(6);
    } finally {
      spy.mockRestore();
    }
  });

  test("every result has a composite score in [0, 1]", async () => {
    const spy = mockSpawn();
    try {
      const results = await sampleCompletions(
        ["prompt one", "prompt two"],
        2,
        0.7,
        { model: "/models/test" },
        { adaptorDir: "/tmp/adaptor-no-evals" },
      );
      for (const r of results) {
        expect(typeof r.composite).toBe("number");
        expect(r.composite).toBeGreaterThanOrEqual(0);
        expect(r.composite).toBeLessThanOrEqual(1);
      }
    } finally {
      spy.mockRestore();
    }
  });

  test("returns [] for empty prompts array without error", async () => {
    const spy = spyOn(Bun, "spawn");
    try {
      const results = await sampleCompletions(
        [],
        8,
        0.7,
        { model: "/models/test" },
        { adaptorDir: "/tmp/adaptor-no-evals" },
      );
      expect(results).toHaveLength(0);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("skips completions where estimated token count exceeds 2048", async () => {
    // Generate a completion long enough to exceed the 2048-token limit
    // heuristic: (prompt.length + completion.length) / 4 > 2048
    // Make completion ~8500 chars so combined with short prompt it exceeds limit
    const longCompletion = "x".repeat(8500);
    const longOutput =
      `==========\n${longCompletion}\n==========\n` +
      "Prompt: 5 tokens, Generation: 20.0 tokens/sec\n";
    const spy = spyOn(Bun, "spawn").mockImplementation(
      (() => makeMockProcess(longOutput, "", 0)) as unknown as typeof Bun.spawn,
    );
    try {
      const results = await sampleCompletions(
        ["short prompt"],
        1,
        0.7,
        { model: "/models/test" },
        { adaptorDir: "/tmp/adaptor-no-evals" },
      );
      expect(results).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  test("forwards temperature to every mlx_lm generate call", async () => {
    const spawnArgs: string[][] = [];
    const spy = spyOn(Bun, "spawn").mockImplementation(
      ((args: string[]) => {
        spawnArgs.push([...args]);
        return makeMockProcess(MLX_OUTPUT, "", 0);
      }) as unknown as typeof Bun.spawn,
    );
    try {
      await sampleCompletions(
        ["prompt"],
        2,
        1.0,
        { model: "/models/test" },
        { adaptorDir: "/tmp/adaptor-no-evals" },
      );
      const mlxCalls = spawnArgs.filter((a) => a.includes("mlx_lm"));
      expect(mlxCalls).toHaveLength(2);
      for (const args of mlxCalls) {
        const idx = args.indexOf("--temp");
        expect(idx).toBeGreaterThan(-1);
        expect(args[idx + 1]).toBe("1");
      }
    } finally {
      spy.mockRestore();
    }
  });
});
