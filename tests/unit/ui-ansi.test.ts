import { describe, test, expect } from "bun:test";
import { wrap, stripAnsi, sparkline, BOLD, GREEN, RED, RESET } from "../../src/ui/ansi.js";

describe("wrap", () => {
  test("wraps text with codes when isTTY=true", () => {
    const result = wrap("hello", true, BOLD, GREEN);
    expect(result).toBe(`${BOLD}${GREEN}hello${RESET}`);
  });

  test("returns plain text when isTTY=false", () => {
    expect(wrap("hello", false, BOLD, GREEN)).toBe("hello");
  });

  test("returns plain text when no codes given", () => {
    expect(wrap("hello", true)).toBe("hello");
  });
});

describe("stripAnsi", () => {
  test("strips escape sequences", () => {
    const withAnsi = `${BOLD}${GREEN}hello${RESET}`;
    expect(stripAnsi(withAnsi)).toBe("hello");
  });

  test("leaves plain strings unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  test("strips cursor/erase codes but not carriage return", () => {
    // \x1b[2K and \x1b[K are ANSI sequences; \r is a plain control character
    expect(stripAnsi("\x1b[2Khello\x1b[K")).toBe("hello");
  });
});

describe("sparkline", () => {
  test("returns empty string for empty array", () => {
    expect(sparkline([])).toBe("");
  });

  test("returns a single low bar when all values equal", () => {
    expect(sparkline([5, 5, 5])).toBe("▁▁▁");
  });

  test("maps min to ▁ and max to █", () => {
    const result = sparkline([0, 1]);
    expect(result[0]).toBe("▁");
    expect(result[1]).toBe("█");
  });

  test("length matches input length", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(sparkline(values)).toHaveLength(values.length);
  });

  test("monotone increasing produces ascending bars", () => {
    const result = sparkline([1, 2, 3, 4, 5, 6, 7, 8]);
    // Each character should be >= previous (non-decreasing)
    for (let i = 1; i < result.length; i++) {
      expect(result.charCodeAt(i)).toBeGreaterThanOrEqual(result.charCodeAt(i - 1));
    }
  });
});
