import { describe, test, expect } from "bun:test";
import {
  formatPrompt,
  estimateTokens,
  applyWindow,
} from "../../src/chat/history.js";
import type { Turn } from "../../src/chat/history.js";

// ---------------------------------------------------------------------------
// formatPrompt
// ---------------------------------------------------------------------------

describe("formatPrompt", () => {
  test("returns empty string for empty history", () => {
    expect(formatPrompt([])).toBe("");
  });

  test("formats a single user turn as ChatML", () => {
    const history: Turn[] = [{ role: "user", content: "hello" }];
    const result = formatPrompt(history);
    expect(result).toContain("<|im_start|>user");
    expect(result).toContain("hello");
    expect(result).toContain("<|im_end|>");
    // ends with assistant primer so model knows to respond
    expect(result.trimEnd()).toEndWith("<|im_start|>assistant");
  });

  test("formats a multi-turn conversation as ChatML", () => {
    const history: Turn[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "how are you?" },
    ];
    const result = formatPrompt(history);
    expect(result).toContain("<|im_start|>user\nhello<|im_end|>");
    expect(result).toContain("<|im_start|>assistant\nhi there<|im_end|>");
    expect(result.trimEnd()).toEndWith("<|im_start|>assistant");
  });
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  test("returns 0 for empty history", () => {
    expect(estimateTokens([])).toBe(0);
  });

  test("estimates based on character count / 4", () => {
    const history: Turn[] = [{ role: "user", content: "1234" }]; // 4 chars = 1 token
    expect(estimateTokens(history)).toBe(1);
  });

  test("sums across all turns", () => {
    const history: Turn[] = [
      { role: "user", content: "12345678" },       // 8 chars = 2 tokens
      { role: "assistant", content: "12345678" },  // 8 chars = 2 tokens
    ];
    expect(estimateTokens(history)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// applyWindow
// ---------------------------------------------------------------------------

describe("applyWindow", () => {
  test("returns history unchanged when under the limit", () => {
    const history: Turn[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const result = applyWindow(history, 6000);
    expect(result).toEqual(history);
  });

  test("drops oldest turns when over the limit", () => {
    // Each turn has 4000 chars = 1000 tokens. Two turns = 2000, three = 3000.
    // With limit 2500 tokens, three turns should be trimmed to two.
    const longContent = "x".repeat(4000);
    const history: Turn[] = [
      { role: "user", content: longContent },
      { role: "assistant", content: longContent },
      { role: "user", content: longContent },
    ];
    const result = applyWindow(history, 2500);
    expect(result.length).toBeLessThan(history.length);
  });

  test("always keeps at least the last user turn", () => {
    // Even if the last turn alone exceeds the limit, we keep it
    const hugeContent = "x".repeat(100000);
    const history: Turn[] = [{ role: "user", content: hugeContent }];
    const result = applyWindow(history, 10);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
  });

  test("keeps most recent turns when truncating", () => {
    const longContent = "x".repeat(4000);
    const history: Turn[] = [
      { role: "user", content: "old turn" },
      { role: "assistant", content: "old response" },
      { role: "user", content: longContent },
      { role: "assistant", content: longContent },
      { role: "user", content: longContent },
    ];
    const result = applyWindow(history, 2500);
    // Most recent content should be in the result
    const hasRecent = result.some((t) => t.content === longContent);
    expect(hasRecent).toBe(true);
    // Old turn with "old turn" should be dropped
    const hasOld = result.some((t) => t.content === "old turn");
    expect(hasOld).toBe(false);
  });
});
