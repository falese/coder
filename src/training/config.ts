import { z } from "zod";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parse } from "smol-toml";

export const TrainConfigSchema = z.object({
  model: z.object({
    path: z.string().min(1),
  }),
  lora: z.object({
    rank: z.number().int().positive(),
    target_modules: z.array(z.string()).min(1),
    iters: z.number().int().positive(),
    batch_size: z.number().int().positive(),
    learning_rate: z.number().positive(),
  }),
  data: z.object({
    dir: z.string().min(1),
  }),
  output: z.object({
    adaptor_dir: z.string().min(1),
    manifest: z.string().min(1),
    log_file: z.string().min(1),
  }),
});

export type TrainConfig = z.infer<typeof TrainConfigSchema>;

function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return homedir() + p.slice(1);
  }
  return p;
}

export function loadTrainConfig(tomlPath: string): TrainConfig {
  const raw = readFileSync(tomlPath, "utf-8");
  const parsed = parse(raw) as unknown;
  const config = TrainConfigSchema.parse(parsed);

  return {
    ...config,
    model: { path: expandPath(config.model.path) },
    data: { dir: expandPath(config.data.dir) },
    output: {
      adaptor_dir: expandPath(config.output.adaptor_dir),
      manifest: expandPath(config.output.manifest),
      log_file: expandPath(config.output.log_file),
    },
  };
}

export function generateLoraYaml(config: TrainConfig): string {
  const { rank } = config.lora;
  const alpha = rank * 2;
  return [
    `lora_layers: 16`,
    `lora_parameters:`,
    `  rank: ${String(rank)}`,
    `  alpha: ${String(alpha)}`,
    `  dropout: 0.0`,
    `  scale: 10.0`,
    "",
  ].join("\n");
}
