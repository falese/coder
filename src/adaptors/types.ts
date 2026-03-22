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
  author: z.string(),
  description: z.string(),
});

export type AdaptorManifest = z.infer<typeof ManifestSchema>;

export interface AdaptorEntry {
  name: string;
  path: string;
  manifest: AdaptorManifest;
}
