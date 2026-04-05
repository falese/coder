import { z } from "zod";

export const ManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string(),
  domain: z.string(),
  base_model: z.string(),
  mlx_quant: z.string(),
  lora_rank: z.number().int().positive(),
  min_memory_gb: z.number().positive(),
  eval_pass_rate: z.number().min(0).max(1),
  baseline_pass_rate: z.number().min(0).max(1).optional(),
  author: z.string(),
  description: z.string(),
  self_improve_rounds: z.number().int().nonnegative().optional(),
  self_improve_score_history: z.array(z.number()).optional(),
  self_improve_last_run: z.string().optional(),
});

export type AdaptorManifest = z.infer<typeof ManifestSchema>;

export interface AdaptorEntry {
  name: string;
  path: string;
  manifest: AdaptorManifest;
}
