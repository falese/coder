import { describe, test, expect } from "bun:test";
import { ManifestSchema } from "../../src/adaptors/types.js";

// ---------------------------------------------------------------------------
// A LoRA pack — every weight-bearing field present, no explicit mode.
// ---------------------------------------------------------------------------

const LORA_MANIFEST = {
  name: "react-ts",
  version: "1.0.0",
  domain: "frontend",
  base_model: "Qwen2.5-Coder-7B",
  mlx_quant: "4bit",
  lora_rank: 8,
  min_memory_gb: 18,
  eval_pass_rate: 0.85,
  author: "test",
  description: "A LoRA adaptor",
};

// ---------------------------------------------------------------------------
// A weightless pack — served base model + system prompt, no weights.
// ---------------------------------------------------------------------------

const INFERENCE_ONLY_MANIFEST = {
  name: "drift-audit",
  version: "0.1.0",
  domain: "governance-drift",
  mode: "inference-only",
  base_model: "Qwen2.5-Coder-7B-Instruct",
  author: "",
  description: "Emit a typed drift finding",
};

function without<T extends Record<string, unknown>>(obj: T, key: keyof T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => k !== key),
  ) as Partial<T>;
}

describe("ManifestSchema — mode", () => {
  test("defaults mode to 'lora' when omitted (backward compatible)", () => {
    const m = ManifestSchema.parse(LORA_MANIFEST);
    expect(m.mode).toBe("lora");
    expect(m.lora_rank).toBe(8);
  });

  test("accepts a weightless inference-only manifest with no LoRA fields", () => {
    const m = ManifestSchema.parse(INFERENCE_ONLY_MANIFEST);
    expect(m.mode).toBe("inference-only");
    expect(m.lora_rank).toBeUndefined();
    expect(m.mlx_quant).toBeUndefined();
    expect(m.min_memory_gb).toBeUndefined();
    expect(m.eval_pass_rate).toBeUndefined();
  });

  test("rejects a LoRA manifest missing lora_rank", () => {
    expect(() => ManifestSchema.parse(without(LORA_MANIFEST, "lora_rank"))).toThrow();
  });

  test("rejects a LoRA manifest (explicit mode) missing mlx_quant", () => {
    expect(() =>
      ManifestSchema.parse({ ...without(LORA_MANIFEST, "mlx_quant"), mode: "lora" }),
    ).toThrow();
  });

  test("rejects an unknown mode value", () => {
    expect(() =>
      ManifestSchema.parse({ ...INFERENCE_ONLY_MANIFEST, mode: "served" }),
    ).toThrow();
  });

  test("still requires the always-present fields even when inference-only", () => {
    expect(() =>
      ManifestSchema.parse(without(INFERENCE_ONLY_MANIFEST, "base_model")),
    ).toThrow();
  });

  test("inference-only manifest may still carry an eval_pass_rate if it wants", () => {
    const m = ManifestSchema.parse({ ...INFERENCE_ONLY_MANIFEST, eval_pass_rate: 1 });
    expect(m.eval_pass_rate).toBe(1);
  });
});
