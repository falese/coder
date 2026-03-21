import { describe, test, expect, spyOn } from "bun:test";
import { parseMlxOutput, runMlx } from "../../src/inference/mlx-runner.js";

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
