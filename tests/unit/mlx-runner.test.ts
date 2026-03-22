import { describe, test, expect, spyOn, beforeEach } from "bun:test";
import {
  parseMlxOutput,
  runMlx,
  runMlxBuffered,
  runMlxStream,
  checkPreflight,
  resetPreflightForTest,
  markPreflightDoneForTest,
} from "../../src/inference/mlx-runner.js";

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

// ---------------------------------------------------------------------------
// parseMlxOutput — pure function, zero mocks
// ---------------------------------------------------------------------------

const SAMPLE_OUTPUT =
  `==========\nPrompt: hello world\ngenerated code here\n==========\n` +
  `Prompt: 5 tokens, Generation: 100.5 tokens/sec\n`;

describe("parseMlxOutput", () => {
  test("extracts generated text", () => {
    const result = parseMlxOutput(SAMPLE_OUTPUT);
    expect(result.generatedText).toBe("generated code here");
  });

  test("extracts tokens per second", () => {
    const result = parseMlxOutput(SAMPLE_OUTPUT);
    expect(result.tokensPerSecond).toBe(100.5);
  });

  test("handles missing stats line", () => {
    const noStats =
      `==========\nPrompt: hello\nsome output\n==========\n`;
    const result = parseMlxOutput(noStats);
    expect(result.tokensPerSecond).toBeUndefined();
  });

  test("handles empty content", () => {
    const empty = `==========\nPrompt: hello\n\n==========\n`;
    const result = parseMlxOutput(empty);
    expect(result.generatedText).toBe("");
  });
});

// ---------------------------------------------------------------------------
// runMlx — mocked Bun.spawn
// ---------------------------------------------------------------------------

describe("runMlx with mocked spawn", () => {
  beforeEach(() => {
    markPreflightDoneForTest();
  });

  test("success path returns parsed result", async () => {
    const mockOutput =
      `==========\nPrompt: test\nhello world\n==========\n` +
      `Prompt: 2 tokens, Generation: 50.0 tokens/sec\n`;

    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess(mockOutput, "", 0) as ReturnType<typeof Bun.spawn>,
    );
    try {
      const result = await runMlx({ model: "/models/test", prompt: "test" });
      expect(result.generatedText).toBe("hello world");
      expect(result.tokensPerSecond).toBe(50.0);
    } finally {
      spy.mockRestore();
    }
  });

  test("non-zero exit throws", async () => {
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("", "some error occurred", 1) as ReturnType<
        typeof Bun.spawn
      >,
    );
    let threw = false;
    try {
      await runMlx({ model: "/models/test", prompt: "test" });
    } catch {
      threw = true;
    } finally {
      spy.mockRestore();
    }
    expect(threw).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runMlxBuffered — TTFT + backward-compat alias
// ---------------------------------------------------------------------------

describe("runMlxBuffered", () => {
  beforeEach(() => {
    markPreflightDoneForTest();
  });

  test("is the same function as runMlx (backward-compat alias)", () => {
    expect(runMlxBuffered).toBe(runMlx);
  });

  test("dry-run returns expected text", async () => {
    const result = await runMlxBuffered({
      model: "/models/test",
      prompt: "hello",
      dryRun: true,
    });
    expect(result.generatedText).toContain("dry-run");
    expect(result.generatedText).toContain("hello");
  });

  test("records ttftMs on first non-empty chunk", async () => {
    const mockOutput =
      `==========\nPrompt: test\nhello\n==========\n` +
      `Prompt: 2 tokens, Generation: 50.0 tokens/sec\n`;
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess(mockOutput, "", 0) as ReturnType<typeof Bun.spawn>,
    );
    try {
      const result = await runMlxBuffered({ model: "/models/test", prompt: "test" });
      expect(typeof result.ttftMs).toBe("number");
      expect(result.ttftMs).toBeGreaterThanOrEqual(0);
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// runMlxStream
// ---------------------------------------------------------------------------

describe("runMlxStream", () => {
  beforeEach(() => {
    markPreflightDoneForTest();
  });

  test("dry-run yields the dry-run text and resolves result", async () => {
    const { stream, result } = runMlxStream({
      model: "/models/test",
      prompt: "hello",
      dryRun: true,
    });
    const reader = stream.getReader();
    const chunks: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const finalResult = await result;
    expect(chunks.join("")).toContain("dry-run");
    expect(finalResult.generatedText).toContain("dry-run");
  });

  test("yields chunks via ReadableStream for live output", async () => {
    const mockOutput =
      `==========\nPrompt: test\nhello world\n==========\n` +
      `Prompt: 2 tokens, Generation: 50.0 tokens/sec\n`;
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess(mockOutput, "", 0) as ReturnType<typeof Bun.spawn>,
    );
    try {
      const { stream, result } = runMlxStream({ model: "/models/test", prompt: "test" });
      const reader = stream.getReader();
      let accumulated = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += value;
      }
      const finalResult = await result;
      expect(accumulated.length).toBeGreaterThan(0);
      expect(finalResult.generatedText).toBe("hello world");
      expect(finalResult.tokensPerSecond).toBe(50.0);
    } finally {
      spy.mockRestore();
    }
  });

  test("result promise resolves with ttftMs after stream closes", async () => {

    const mockOutput =
      `==========\nPrompt: test\nhello\n==========\n` +
      `Prompt: 2 tokens, Generation: 50.0 tokens/sec\n`;
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess(mockOutput, "", 0) as ReturnType<typeof Bun.spawn>,
    );
    try {
      const { stream, result } = runMlxStream({ model: "/models/test", prompt: "test" });
      // consume stream
      const reader = stream.getReader();
      let readDone = false;
      while (!readDone) {
        const chunk = await reader.read();
        readDone = chunk.done;
      }
      const finalResult = await result;
      expect(typeof finalResult.ttftMs).toBe("number");
      expect(finalResult.ttftMs).toBeGreaterThanOrEqual(0);
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// checkPreflight
// ---------------------------------------------------------------------------

describe("checkPreflight", () => {
  beforeEach(() => {
    resetPreflightForTest();
  });

  test("skips when CODER_DRY_RUN=1", async () => {
    const prev = process.env.CODER_DRY_RUN;
    process.env.CODER_DRY_RUN = "1";
    const spy = spyOn(Bun, "spawn");
    try {
      await checkPreflight();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.CODER_DRY_RUN;
      else process.env.CODER_DRY_RUN = prev;
      spy.mockRestore();
      resetPreflightForTest();
    }
  });

  test("caches result — second call does not spawn again", async () => {
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("", "", 0) as ReturnType<typeof Bun.spawn>,
    );
    try {
      await checkPreflight();
      await checkPreflight();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  test("throws python3 message when exit code is 127", async () => {
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("", "", 127) as ReturnType<typeof Bun.spawn>,
    );
    let threw = false;
    let message = "";
    try {
      await checkPreflight();
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    } finally {
      spy.mockRestore();
    }
    expect(threw).toBe(true);
    expect(message).toContain("python3 not found");
  });

  test("throws mlx_lm message when exit 1 and stderr contains 'No module named mlx_lm'", async () => {
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("", "No module named mlx_lm", 1) as ReturnType<typeof Bun.spawn>,
    );
    let threw = false;
    let message = "";
    try {
      await checkPreflight();
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    } finally {
      spy.mockRestore();
    }
    expect(threw).toBe(true);
    expect(message).toContain("mlx_lm not installed");
  });

  test("resolves without error on exit 0", async () => {
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("", "", 0) as ReturnType<typeof Bun.spawn>,
    );
    try {
      await checkPreflight();
    } finally {
      spy.mockRestore();
    }
    // no throw = pass
  });
});
