import { Command } from "commander";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config/loader.js";
import { listModels, getModelEntry } from "../models/inspector.js";
import { pullModel } from "../models/pull.js";

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(1)} KB`;
}

function getModelsDir(): string {
  if (process.env.CODER_MODELS_DIR) return process.env.CODER_MODELS_DIR;
  return loadConfig().models_dir;
}

function resolveModelDir(modelsDir: string, name: string): string {
  return join(modelsDir, name);
}

export function createModelsCommand(): Command {
  const cmd = new Command("models").description("Manage local MLX models");

  cmd
    .command("list")
    .description("List downloaded models")
    .action(() => {
      const modelsDir = getModelsDir();
      const entries = listModels(modelsDir);

      const header = `${"NAME".padEnd(55)} ${"QUANT".padEnd(7)} ${"DISK".padEnd(10)} MEMORY`;
      process.stdout.write(header + "\n");

      for (const entry of entries) {
        const quant = `${String(entry.quantBits)}-bit`;
        const disk = formatBytes(entry.diskSizeBytes);
        const memory = formatBytes(entry.memoryEstimateGb * 1e9);
        const line = `${entry.name.padEnd(55)} ${quant.padEnd(7)} ${disk.padEnd(10)} ${memory}\n`;
        process.stdout.write(line);
      }
    });

  cmd
    .command("info <name>")
    .description("Show model metadata and memory footprint")
    .action((name: string) => {
      const modelsDir = getModelsDir();
      const modelDir = resolveModelDir(modelsDir, name);

      if (!existsSync(modelDir)) {
        process.stderr.write(`Error: model "${name}" not found in ${modelsDir}\n`);
        process.exit(1);
      }

      const entry = getModelEntry(name, modelDir);
      process.stdout.write(`Name:   ${entry.name}\n`);
      process.stdout.write(`Type:   ${entry.modelType}\n`);
      process.stdout.write(`Quant:  ${String(entry.quantBits)}-bit\n`);
      process.stdout.write(`Disk:   ${formatBytes(entry.diskSizeBytes)}\n`);
      process.stdout.write(`Memory: ${formatBytes(entry.memoryEstimateGb * 1e9)}\n`);
    });

  cmd
    .command("remove <name>")
    .description("Delete a local model")
    .action((name: string) => {
      const modelsDir = getModelsDir();
      const modelDir = resolveModelDir(modelsDir, name);

      if (!existsSync(modelDir)) {
        process.stderr.write(`Error: model "${name}" not found in ${modelsDir}\n`);
        process.exit(1);
      }

      rmSync(modelDir, { recursive: true, force: true });
      process.stdout.write(`Removed ${name}\n`);
    });

  cmd
    .command("pull <repo-id>")
    .description("Download a model from HuggingFace")
    .action(async (repoId: string) => {
      const modelsDir = getModelsDir();
      try {
        await pullModel(repoId, modelsDir);
      } catch (err) {
        process.stderr.write(
          `Error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }
    });

  return cmd;
}
