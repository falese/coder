import { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import {
  listAdaptors,
  readManifest,
  removeAdaptor,
  installAdaptor,
  updateAdaptor,
} from "../adaptors/manager.js";
import { loadTrainConfig } from "../training/config.js";
import { runMlxTrain } from "../training/runner.js";
import { runEval, formatEvalTable, formatEvalReport, updateManifestScore } from "../eval/runner.js";
import { runSelfImprove } from "../adaptors/self-improve.js";
import { logger } from "../observability/logger.js";
import { join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";

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
        if (manifest.self_improve_rounds !== undefined) {
          process.stdout.write(`SSD rounds:  ${String(manifest.self_improve_rounds)}\n`);
        }
        if (manifest.self_improve_last_run !== undefined) {
          process.stdout.write(`SSD last run: ${manifest.self_improve_last_run}\n`);
        }
        if (manifest.self_improve_score_history !== undefined) {
          process.stdout.write(
            `SSD history: ${manifest.self_improve_score_history.map((s) => s.toFixed(3)).join(" → ")}\n`,
          );
        }
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

  cmd
    .command("train")
    .description("Run LoRA fine-tuning from a train config file")
    .requiredOption("--config <path>", "Path to train-config.toml")
    .action(async (options: { config: string }) => {
      const dryRun = process.env.CODER_DRY_RUN === "1";
      try {
        const config = loadTrainConfig(options.config);
        await runMlxTrain(config, dryRun);
        process.stdout.write("Training complete.\n");
      } catch (err) {
        process.stderr.write(
          `Error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }
    });

  cmd
    .command("eval <name>")
    .description("Score adaptor output quality against the eval suite")
    .option("--model <path>", "Model path (defaults to config default_model)")
    .option("--input <file>", "Override eval JSONL (default: <adaptor>/data/eval.jsonl)")
    .option("--baseline", "Write score to baseline_pass_rate instead of eval_pass_rate")
    .option("--verbose", "Print generated code and scorer diagnostics to terminal")
    .option("--report <file>", "Write detailed markdown report to file")
    .action(
      async (
        name: string,
        options: { model?: string; input?: string; baseline?: boolean; verbose?: boolean; report?: string },
      ) => {
        const dryRun = process.env.CODER_DRY_RUN === "1";
        const config = loadConfig();
        const modelPath = options.model ?? config.default_model;

        if (!modelPath && !dryRun) {
          process.stderr.write(
            "Error: no model specified. Use --model or set default_model in config\n",
          );
          process.exit(1);
        }

        const adaptorsDir = getAdaptorsDir();
        const adaptorDir = join(adaptorsDir, name);

        if (!existsSync(adaptorDir)) {
          process.stderr.write(`Error: adaptor "${name}" not found\n`);
          process.exit(1);
        }

        const weightsPath = join(adaptorDir, "weights");
        const adaptorPath = options.baseline === true ? undefined : weightsPath;

        try {
          const summary = await runEval(adaptorDir, {
            modelPath: modelPath,
            adaptorPath,
            inputFile: options.input,
            dryRun,
          });

          process.stdout.write(formatEvalTable(summary) + "\n");

          if (options.verbose === true) {
            process.stdout.write("\n" + formatEvalReport(summary) + "\n");
          }

          if (options.report) {
            writeFileSync(options.report, formatEvalReport(summary));
            process.stdout.write(`Report written to ${options.report}\n`);
          }

          const manifestPath = join(adaptorDir, "manifest.json");
          updateManifestScore(manifestPath, summary.meanComposite, options.baseline ?? false);

          const scoreField =
            options.baseline === true ? "baseline_pass_rate" : "eval_pass_rate";
          process.stdout.write(
            `Updated ${scoreField}: ${summary.meanComposite.toFixed(3)}\n`,
          );

          logger.logEvent({
            event: "eval_complete",
            ts: new Date().toISOString(),
            adaptor: name,
            composite_score: summary.meanComposite,
            tsc_score: summary.meanTsc,
            eslint_score: summary.meanEslint,
            test_score: summary.meanTests,
            record_count: summary.records.length,
          });
        } catch (err) {
          process.stderr.write(
            `Error: ${err instanceof Error ? err.message : String(err)}\n`,
          );
          process.exit(1);
        }
      },
    );

  cmd
    .command("self-improve <name>")
    .description("recursively fine-tune an adaptor on its own high-scoring outputs")
    .option("--rounds <n>", "SSD iterations to run", "3")
    .option("--samples <k>", "completions per prompt per round", "8")
    .option("--temperature <t>", "sampling temperature or 'adaptive'", "adaptive")
    .option("--threshold <score>", "min composite score to keep a sample", "0.7")
    .option("--model <path>", "base model path (falls back to config default_model)")
    .option("--dry-run", "honour CODER_DRY_RUN=1; skip actual inference and training")
    .action(
      async (
        name: string,
        options: {
          rounds: string;
          samples: string;
          temperature: string;
          threshold: string;
          model?: string;
          dryRun?: boolean;
        },
      ) => {
        const dryRun =
          options.dryRun === true || process.env.CODER_DRY_RUN === "1";
        const config = loadConfig();
        const modelPath = options.model ?? config.default_model;

        if (!modelPath && !dryRun) {
          process.stderr.write(
            "Error: no model specified. Use --model or set default_model in config\n",
          );
          process.exit(1);
        }

        const adaptorsDir = getAdaptorsDir();
        const adaptorDir = join(adaptorsDir, name);

        if (!existsSync(adaptorDir)) {
          process.stderr.write(`Error: adaptor "${name}" not found\n`);
          process.exit(1);
        }

        const temperature: number | "adaptive" =
          options.temperature === "adaptive"
            ? "adaptive"
            : parseFloat(options.temperature);

        try {
          const results = await runSelfImprove({
            adaptorDir,
            modelPath,
            rounds: parseInt(options.rounds, 10),
            samplesPerPrompt: parseInt(options.samples, 10),
            threshold: parseFloat(options.threshold),
            temperature,
            dryRun,
          });

          for (const r of results) {
            const delta = r.scoreAfter - r.scoreBefore;
            const sign = delta >= 0 ? "+" : "";
            const tag = r.committed ? "[committed]" : "[rolled back]";
            process.stderr.write(
              `Round ${String(r.round)}/${String(results.length)}: ` +
              `generated ${String(r.generated)}  filtered (≥${options.threshold}): ${String(r.filtered)}  ` +
              `eval: ${r.scoreBefore.toFixed(3)} → ${r.scoreAfter.toFixed(3)} ` +
              `(${sign}${delta.toFixed(3)})  ${tag}\n`,
            );
          }

          const committed = results.filter((r) => r.committed).length;
          const finalScore = results.at(-1)?.scoreAfter ?? 0;
          process.stdout.write(
            `Self-improvement complete. Final score: ${finalScore.toFixed(3)} ` +
            `(rounds committed: ${String(committed)}/${String(results.length)})\n`,
          );
        } catch (err) {
          process.stderr.write(
            `Error: ${err instanceof Error ? err.message : String(err)}\n`,
          );
          process.exit(1);
        }
      },
    );

  return cmd;
}
