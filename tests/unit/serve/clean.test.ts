import { describe, test, expect } from "bun:test";
import { cleanMlxText } from "../../../src/serve/clean.js";

describe("cleanMlxText", () => {
  test("extracts generated text from newer mlx framing + stats", () => {
    const raw =
      "==========\nThat sounds great!\n==========\nPrompt: 5 tokens, 1.2 tokens-per-sec\nGeneration: 3 tokens, 2.1 tokens-per-sec\nPeak memory: 4.5 GB\n";
    expect(cleanMlxText(raw)).toBe("That sounds great!");
  });

  test("strips chat-template special tokens", () => {
    const raw = "==========\nHello there<|im_end|>\n==========\nPrompt: 1 tokens\n";
    expect(cleanMlxText(raw)).toBe("Hello there");
  });

  test("strips an older-format Prompt: echo line", () => {
    const raw = "==========\nPrompt: write a haiku\nsilent code compiles\n==========\nGeneration: 2 tokens\n";
    expect(cleanMlxText(raw)).toBe("silent code compiles");
  });

  test("returns text seen so far when the closing banner has not arrived", () => {
    const raw = "==========\nThinking about this";
    expect(cleanMlxText(raw)).toBe("Thinking about this");
  });

  test("returns dry-run / unframed text unchanged (minus special tokens)", () => {
    expect(cleanMlxText("# dry-run: hello")).toBe("# dry-run: hello");
    expect(cleanMlxText("plain<|endoftext|> text")).toBe("plain text");
  });

  test("a partial opening banner yields no generated text", () => {
    expect(cleanMlxText("=====")).toBe("=====");
    expect(cleanMlxText("==========\n")).toBe("");
  });

  test("preserves a <threads> block (no pipe — not a special token)", () => {
    const raw = '==========\nGo on.\n<threads>{"threads":["a"]}</threads><|im_end|>\n==========\n';
    expect(cleanMlxText(raw)).toBe('Go on.\n<threads>{"threads":["a"]}</threads>');
  });
});
