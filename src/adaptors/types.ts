import { z } from "zod";

/**
 * Adaptor packaging modes.
 *
 * - `lora` — the historic shape: a fine-tuned LoRA adaptor with quantised
 *   weights on disk. Requires `mlx_quant`, `lora_rank`, `min_memory_gb` and an
 *   `eval_pass_rate` (its train/eval gate).
 * - `inference-only` — a *weightless* pack: a served base model + a system
 *   prompt + a typed output contract. No corpus, no `train.jsonl`, no
 *   `adaptor.safetensors`, no train/eval gate. Precision comes from a
 *   deterministic floor downstream, not from weights (see the drift-audit pack
 *   and ADR-090). The LoRA-only fields are meaningless here and are omitted.
 */
export const ADAPTOR_MODES = ["lora", "inference-only"] as const;
export type AdaptorMode = (typeof ADAPTOR_MODES)[number];

/**
 * LoRA-only fields, required when `mode` is `lora` (the default) and absent for
 * a weightless `inference-only` pack.
 */
const LORA_ONLY_FIELDS = ["mlx_quant", "lora_rank", "min_memory_gb", "eval_pass_rate"] as const;

export const ManifestSchema = z
  .object({
    name: z.string().min(1),
    version: z.string(),
    domain: z.string(),
    // Defaults to `lora` so every existing manifest (which has no `mode`) keeps
    // its old meaning and required-field set.
    mode: z.enum(ADAPTOR_MODES).default("lora"),
    base_model: z.string(),
    mlx_quant: z.string().optional(),
    lora_rank: z.number().int().positive().optional(),
    min_memory_gb: z.number().positive().optional(),
    eval_pass_rate: z.number().min(0).max(1).optional(),
    baseline_pass_rate: z.number().min(0).max(1).optional(),
    persona_f1: z.number().min(0).max(1).optional(),
    author: z.string(),
    description: z.string(),
  })
  .superRefine((manifest, ctx) => {
    // A LoRA pack must carry all of its weight-bearing fields. A weightless
    // pack must not be forced to invent a `lora_rank` to satisfy the schema.
    if (manifest.mode === "lora") {
      for (const field of LORA_ONLY_FIELDS) {
        if (manifest[field] === undefined) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `${field} is required for a LoRA adaptor (mode "lora")`,
          });
        }
      }
    }
  });

export type AdaptorManifest = z.infer<typeof ManifestSchema>;

export interface AdaptorEntry {
  name: string;
  path: string;
  manifest: AdaptorManifest;
}
