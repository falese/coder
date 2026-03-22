import { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import {
  listAdaptors,
  readManifest,
  removeAdaptor,
  installAdaptor,
  updateAdaptor,
} from "../adaptors/manager.js";
import { join } from "node:path";
import { existsSync } from "node:fs";

function getAdaptorsDir(): string {
  return loadConfig().adaptors_dir;
}

export function createAdaptorCommand(): Command {
  const cmd = new Command("adaptor").description("Manage LoRA adaptor packs");

  cmd
    .command("list")
    .description("List installed adaptors")
    .action(() => {
      const adaptorsDir = getAdaptorsDir();
      const entries = listAdaptors(adaptorsDir);

      const header = `${"NAME".padEnd(20)} ${"VERSION".padEnd(10)} ${"DOMAIN".padEnd(15)} BASE_MODEL`;
      process.stdout.write(header + "\n");

      for (const entry of entries) {
        const line =
          `${entry.name.padEnd(20)} ` +
          `${entry.manifest.version.padEnd(10)} ` +
          `${entry.manifest.domain.padEnd(15)} ` +
          `${entry.manifest.base_model}\n`;
        process.stdout.write(line);
      }
    });

  cmd
    .command("install <name>")
    .description("Install an adaptor pack from a git URL")
    .requiredOption("--from-git <url>", "Git URL to clone from")
    .action(async (name: string, options: { fromGit: string }) => {
      const adaptorsDir = getAdaptorsDir();
      try {
        await installAdaptor(name, options.fromGit, adaptorsDir);
        process.stdout.write(`Installed ${name}\n`);
      } catch (err) {
        process.stderr.write(
          `Error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }
    });

  cmd
    .command("update <name>")
    .description("Pull latest changes for an installed adaptor")
    .action(async (name: string) => {
      const adaptorsDir = getAdaptorsDir();
      try {
        await updateAdaptor(name, adaptorsDir);
        process.stdout.write(`Updated ${name}\n`);
      } catch (err) {
        process.stderr.write(
          `Error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }
    });

  cmd
    .command("info <name>")
    .description("Show adaptor metadata")
    .action((name: string) => {
      const adaptorsDir = getAdaptorsDir();
      const adaptorDir = join(adaptorsDir, name);

      if (!existsSync(adaptorDir)) {
        process.stderr.write(`Error: adaptor "${name}" not found\n`);
        process.exit(1);
      }

      try {
        const manifest = readManifest(adaptorDir);
        process.stdout.write(`Name:        ${manifest.name}\n`);
        process.stdout.write(`Version:     ${manifest.version}\n`);
        process.stdout.write(`Domain:      ${manifest.domain}\n`);
        process.stdout.write(`Base model:  ${manifest.base_model}\n`);
        process.stdout.write(`MLX quant:   ${manifest.mlx_quant}\n`);
        process.stdout.write(`LoRA rank:   ${String(manifest.lora_rank)}\n`);
        process.stdout.write(`Min memory:  ${String(manifest.min_memory_gb)} GB\n`);
        process.stdout.write(`Eval pass:   ${String(manifest.eval_pass_rate)}\n`);
        process.stdout.write(`Author:      ${manifest.author}\n`);
        process.stdout.write(`Description: ${manifest.description}\n`);
      } catch (err) {
        process.stderr.write(
          `Error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }
    });

  cmd
    .command("remove <name>")
    .description("Delete an installed adaptor")
    .action((name: string) => {
      const adaptorsDir = getAdaptorsDir();
      try {
        removeAdaptor(name, adaptorsDir);
        process.stdout.write(`Removed ${name}\n`);
      } catch (err) {
        process.stderr.write(
          `Error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }
    });

  return cmd;
}
