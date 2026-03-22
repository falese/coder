import { describe, test, expect } from "bun:test";
import { ExtractConfigSchema } from "../../src/data/types.js";

describe("ExtractConfigSchema", () => {
  test("accepts valid config with jsdoc → next_function rule", () => {
    const result = ExtractConfigSchema.safeParse({
      rules: [{ prompt: "jsdoc", completion: "next_function" }],
    });
    expect(result.success).toBe(true);
  });

  test("accepts valid config with line_comment → next_block rule", () => {
    const result = ExtractConfigSchema.safeParse({
      rules: [{ prompt: "line_comment", completion: "next_block" }],
    });
    expect(result.success).toBe(true);
  });

  test("accepts multiple rules", () => {
    const result = ExtractConfigSchema.safeParse({
      rules: [
        { prompt: "jsdoc", completion: "next_function" },
        { prompt: "line_comment", completion: "next_block" },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("rejects unknown prompt anchor", () => {
    const result = ExtractConfigSchema.safeParse({
      rules: [{ prompt: "block_comment", completion: "next_function" }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects unknown completion anchor", () => {
    const result = ExtractConfigSchema.safeParse({
      rules: [{ prompt: "jsdoc", completion: "next_line" }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty rules array", () => {
    const result = ExtractConfigSchema.safeParse({ rules: [] });
    expect(result.success).toBe(false);
  });

  test("rejects missing rules field", () => {
    const result = ExtractConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
