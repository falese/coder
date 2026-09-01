import { describe, test, expect, spyOn, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseMlxOutput,
  resolveExtraEosTokens,
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

// Old mlx_lm format: Prompt echo in generated section, tokens/sec in footer
const SAMPLE_OUTPUT =
  `==========\nPrompt: hello world\ngenerated code here\n==========\n` +
  `Prompt: 5 tokens, Generation: 100.5 tokens/sec\n`;

// New mlx_lm format: no Prompt echo, tokens-per-sec in footer
const NEW_FORMAT_OUTPUT =
  `==========\nconst x = 1;\n==========\n` +
  `Prompt: 10 tokens, 67.381 tokens-per-sec\nGeneration: 5 tokens, 26.200 tokens-per-sec\n`;

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

  test("new format: extracts generated text without prompt echo", () => {
    const result = parseMlxOutput(NEW_FORMAT_OUTPUT);
    expect(result.generatedText).toBe("const x = 1;");
  });

  test("new format: extracts tokens-per-sec from Generation line", () => {
    const result = parseMlxOutput(NEW_FORMAT_OUTPUT);
    expect(result.tokensPerSecond).toBeCloseTo(26.2);
  });

  test("new format: multiline generated text", () => {
    const multi =
      `==========\nfunction Button({\n  children,\n  ...props\n})\n==========\n` +
      `Prompt: 10 tokens, 67.0 tokens-per-sec\nGeneration: 20 tokens, 25.0 tokens-per-sec\n`;
    const result = parseMlxOutput(multi);
    expect(result.generatedText).toBe("function Button({\n  children,\n  ...props\n})");
    expect(result.tokensPerSecond).toBeCloseTo(25.0);
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

// ---------------------------------------------------------------------------
// Chat end tokens — model framing, never generated content
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Extra EOS tokens — make generation actually halt
// ---------------------------------------------------------------------------

describe("resolveExtraEosTokens", () => {
  function modelDirWith(addedTokens: Record<string, number> | string): string {
    const dir = mkdtempSync(join(tmpdir(), "coder-model-"));
    writeFileSync(
      join(dir, "added_tokens.json"),
      typeof addedTokens === "string" ? addedTokens : JSON.stringify(addedTokens),
    );
    return dir;
  }

  test("returns only the chat end tokens the tokenizer actually has", () => {
    // Passing a token the tokenizer does not know makes mlx_lm raise
    // ValueError, so the set must be intersected with the model's vocab.
    const dir = modelDirWith({ "<|im_end|>": 151645, "<|endoftext|>": 151643 });
    try {
      expect(resolveExtraEosTokens(dir).sort()).toEqual(["<|endoftext|>", "<|im_end|>"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ignores chat end tokens absent from the vocab", () => {
    const dir = modelDirWith({ "<|im_end|>": 151645, "<|fim_pad|>": 151662 });
    try {
      expect(resolveExtraEosTokens(dir)).toEqual(["<|im_end|>"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns nothing when the model is not a local directory", () => {
    // e.g. a bare HF repo id resolved from the mlx cache — degrade quietly.
    expect(resolveExtraEosTokens("mlx-community/Some-Model-4bit")).toEqual([]);
  });

  test("returns nothing when added_tokens.json is malformed", () => {
    const dir = modelDirWith("{ not json");
    try {
      expect(resolveExtraEosTokens(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runMlxBuffered — --extra-eos-token", () => {
  test("forwards the model's chat end tokens so generation halts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coder-model-"));
    writeFileSync(
      join(dir, "added_tokens.json"),
      JSON.stringify({ "<|im_end|>": 151645, "<|endoftext|>": 151643 }),
    );
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("==========\nresult\n==========\n", "", 0) as ReturnType<typeof Bun.spawn>,
    );
    try {
      await runMlxBuffered({ model: dir, prompt: "test" });
      const args: string[] = spy.mock.calls[0]?.[0];
      const idx = args.indexOf("--extra-eos-token");
      expect(idx).toBeGreaterThan(-1);
      expect(args.slice(idx + 1, idx + 3).sort()).toEqual(["<|endoftext|>", "<|im_end|>"]);
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("omits the flag when the model declares no chat end tokens", async () => {
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("==========\nresult\n==========\n", "", 0) as ReturnType<typeof Bun.spawn>,
    );
    try {
      await runMlxBuffered({ model: "/models/no-such-dir", prompt: "test" });
      const args: string[] = spy.mock.calls[0]?.[0];
      expect(args).not.toContain("--extra-eos-token");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("parseMlxOutput — chat end tokens", () => {
  test("truncates at <|im_end|> and drops the degenerate tail after it", () => {
    // A model that does not halt on EOS keeps sampling to the token cap; mlx
    // echoes the lot. Everything from the first end token on is framing/noise.
    const raw =
      "==========\n" +
      "name: payment-cards\nversion: 1.0.0\n<|im_end|>\n!<|im_end|>\n!<|im_end|>\n" +
      "==========\nPrompt: 12 tokens, 90.0 tokens-per-sec\n";

    expect(parseMlxOutput(raw).generatedText).toBe("name: payment-cards\nversion: 1.0.0");
  });

  test("truncates at <|endoftext|>", () => {
    const raw = "==========\nhello<|endoftext|>trailing\n==========\n";

    expect(parseMlxOutput(raw).generatedText).toBe("hello");
  });

  test("leaves output without an end token untouched", () => {
    const raw = "==========\nname: cart\nversion: 1.0.0\n==========\n";

    expect(parseMlxOutput(raw).generatedText).toBe("name: cart\nversion: 1.0.0");
  });

  test("still reports tokens-per-sec when the tail is truncated", () => {
    const raw =
      "==========\ntext<|im_end|>\n!<|im_end|>\n==========\n" +
      "Generation: 40 tokens, 31.4 tokens-per-sec\n";

    expect(parseMlxOutput(raw).tokensPerSecond).toBeCloseTo(31.4);
  });
});

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

  test("forwards --temp when temperature is set", async () => {
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("==========\nresult\n==========\n", "", 0) as ReturnType<typeof Bun.spawn>,
    );
    try {
      await runMlxBuffered({ model: "/models/test", prompt: "test", temperature: 0.7 });
      const args: string[] = spy.mock.calls[0]?.[0];
      const idx = args.indexOf("--temp");
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe("0.7");
    } finally {
      spy.mockRestore();
    }
  });

  test("forwards --top-p when topP is set", async () => {
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("==========\nresult\n==========\n", "", 0) as ReturnType<typeof Bun.spawn>,
    );
    try {
      await runMlxBuffered({ model: "/models/test", prompt: "test", topP: 0.9 });
      const args: string[] = spy.mock.calls[0]?.[0];
      const idx = args.indexOf("--top-p");
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe("0.9");
    } finally {
      spy.mockRestore();
    }
  });

  test("passes the contents of systemFile as --system-prompt, not the path", async () => {
    // mlx_lm's --system-prompt takes the prompt text; handing it a path would
    // make the model's system message the literal string "…/system.md".
    const dir = mkdtempSync(join(tmpdir(), "coder-system-"));
    const file = join(dir, "system.md");
    writeFileSync(file, "You are a manifest compiler. Emit only YAML.\n");
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("==========\nresult\n==========\n", "", 0) as ReturnType<typeof Bun.spawn>,
    );
    try {
      await runMlxBuffered({ model: "/models/test", prompt: "test", systemFile: file });
      const args: string[] = spy.mock.calls[0]?.[0];
      const idx = args.indexOf("--system-prompt");
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe("You are a manifest compiler. Emit only YAML.");
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("passes systemPrompt text straight through as --system-prompt", async () => {
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("==========\nresult\n==========\n", "", 0) as ReturnType<typeof Bun.spawn>,
    );
    try {
      await runMlxBuffered({
        model: "/models/test",
        prompt: "test",
        systemPrompt: "be terse",
      });
      const args: string[] = spy.mock.calls[0]?.[0];
      const idx = args.indexOf("--system-prompt");
      expect(args[idx + 1]).toBe("be terse");
    } finally {
      spy.mockRestore();
    }
  });

  test("omits --temp and --top-p when neither is set", async () => {
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("==========\nresult\n==========\n", "", 0) as ReturnType<typeof Bun.spawn>,
    );
    try {
      await runMlxBuffered({ model: "/models/test", prompt: "test" });
      const args: string[] = spy.mock.calls[0]?.[0];
      expect(args).not.toContain("--temp");
      expect(args).not.toContain("--top-p");
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
