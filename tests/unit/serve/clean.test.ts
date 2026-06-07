import { describe, test, expect } from "bun:test";
import { stripFraming, parseChannels } from "../../../src/serve/clean.js";

describe("stripFraming", () => {
  test("extracts generated text from mlx framing + stats", () => {
    const raw =
      "==========\nThat sounds great!\n==========\nPrompt: 5 tokens, 1.2 tokens-per-sec\nGeneration: 3 tokens\nPeak memory: 4.5 GB\n";
    expect(stripFraming(raw)).toBe("That sounds great!");
  });

  test("drops an older-format Prompt: echo line", () => {
    const raw = "==========\nPrompt: write a haiku\nsilent code compiles\n==========\nGeneration: 2 tokens\n";
    expect(stripFraming(raw)).toBe("silent code compiles");
  });

  test("returns text so far before the closing banner arrives", () => {
    expect(stripFraming("==========\nThinking about this")).toBe("Thinking about this");
  });

  test("returns dry-run / unframed text unchanged", () => {
    expect(stripFraming("# dry-run: hello")).toBe("# dry-run: hello");
  });
});

describe("parseChannels", () => {
  test("plain text is all final (instruct models)", () => {
    expect(parseChannels("Just the answer.")).toEqual({ thought: "", final: "Just the answer." });
  });

  test("splits DeepSeek <think> reasoning from the answer", () => {
    expect(parseChannels("<think>weigh the options</think>do X")).toEqual({
      thought: "weigh the options",
      final: "do X",
    });
  });

  test("splits Harmony channels (analysis vs final)", () => {
    const raw = "<|channel|>analysis<|message|>reasoning here<|end|><|channel|>final<|message|>the answer";
    expect(parseChannels(raw)).toEqual({ thought: "reasoning here", final: "the answer" });
  });

  test("handles the single-pipe <|channel>name variant with a space delimiter", () => {
    expect(parseChannels("<|channel>thought hello there")).toEqual({
      thought: "hello there",
      final: "",
    });
  });

  test("drops other special/chat tokens", () => {
    expect(parseChannels("answer<|im_end|>")).toEqual({ thought: "", final: "answer" });
  });

  test("preserves a <threads> block (no pipe — not a marker)", () => {
    const raw = 'Go on.\n<threads>{"threads":["a"]}</threads><|im_end|>';
    expect(parseChannels(raw)).toEqual({
      thought: "",
      final: 'Go on.\n<threads>{"threads":["a"]}</threads>',
    });
  });
});
