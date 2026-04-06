import { Command } from "commander";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { loadConfig } from "../config/loader.js";
import { ingestFiles } from "../data/ingest.js";
import { extractFromSource } from "../data/extract.js";
import { deduplicate } from "../data/deduplicate.js";
import { validateFile } from "../data/validate.js";
import { splitRecords } from "../data/split.js";
import { computeStats } from "../data/stats.js";
import { ExtractConfigSchema } from "../data/types.js";
import type { JsonlRecord } from "../data/types.js";
import { createDataPromptsCommand } from "./data-prompts.js";

function writeJsonl(records: JsonlRecord[], outPath: string): void {
  const dir = dirname(outPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(outPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

function readJsonl(filePath: string): JsonlRecord[] {
  const content = readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as JsonlRecord);
}

export function createDataCommand(): Command {
  const cmd = new Command("data").description("Dataset curation pipeline for LoRA training");

  cmd
    .command("ingest <glob>")
    .description("Ingest source files into JSONL records")
    .option("-o, --output <file>", "Output file (defaults to stdout)")
    .action((glob: string, options: { output?: string }) => {
      const records = ingestFiles(glob);
      const jsonl = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
      if (options.output) {
        writeJsonl(records, options.output);
        process.stderr.write(
          `Ingested ${String(records.length)} records → ${options.output}\n`,
        );
      } else {
        process.stdout.write(jsonl);
      }
    });

  cmd
    .command("extract")
    .description("Extract prompt/completion pairs using adaptor extract.json rules")
    .requiredOption("--adaptor <name>", "Adaptor name")
    .option("--input <file>", "Input JSONL file (defaults to stdin)")
    .option("-o, --output <file>", "Output file (defaults to stdout)")
    .action(async (options: { adaptor: string; input?: string; output?: string }) => {
      const config = loadConfig();
      const adaptorDir = join(config.adaptors_dir, options.adaptor);
      const extractJsonPath = join(adaptorDir, "extract.json");

      let extractConfig: ReturnType<typeof ExtractConfigSchema.parse>;
      try {
        const raw = JSON.parse(readFileSync(extractJsonPath, "utf-8")) as unknown;
        extractConfig = ExtractConfigSchema.parse(raw);
      } catch (err) {
        process.stderr.write(
          `Error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }

      let sources: string[] = [];
      if (options.input) {
        const inputRecords = readJsonl(options.input);
        sources = inputRecords.map((r) => r.completion);
      } else {
        // Read from stdin
        const chunks: string[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk instanceof Buffer ? chunk.toString("utf-8") : String(chunk));
        }
        const stdinContent = chunks.join("");
        sources = stdinContent
          .split("\n")
          .filter((l) => l.trim().length > 0)
          .map((l) => {
            try {
              return (JSON.parse(l) as JsonlRecord).completion;
            } catch {
              return l;
            }
          });
      }

      const records: JsonlRecord[] = [];
      for (const src of sources) {
        const extracted = extractFromSource(src, extractConfig.rules);
        records.push(...extracted);
      }

      if (options.output) {
        writeJsonl(records, options.output);
        process.stderr.write(
          `Extracted ${String(records.length)} records → ${options.output}\n`,
        );
      } else {
        process.stdout.write(records.map((r) => JSON.stringify(r)).join("\n") + "\n");
      }
    });

  cmd
    .command("deduplicate <file>")
    .description("Remove exact and near-duplicate records")
    .option("-o, --output <file>", "Output file (defaults to stdout)")
    .action((file: string, options: { output?: string }) => {
      let records: JsonlRecord[];
      try {
        records = readJsonl(file);
      } catch (err) {
        process.stderr.write(
          `Error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }

      const { records: deduped, removed } = deduplicate(records);
      const jsonl = deduped.map((r) => JSON.stringify(r)).join("\n") + "\n";

      if (options.output) {
        writeJsonl(deduped, options.output);
      } else {
        process.stdout.write(jsonl);
      }
      process.stderr.write(
        `Removed ${String(removed)} duplicate(s). ${String(deduped.length)} records remain.\n`,
      );
    });

  cmd
    .command("validate <file>")
    .description("Validate JSONL records (non-empty fields, token limits)")
    .option("--min-tokens <n>", "Warn about records below estimated token count", parseInt)
    .action((file: string, options: { minTokens?: number }) => {
      const summary = validateFile(file);
      process.stdout.write(`Total:   ${String(summary.total)}\n`);
      process.stdout.write(`Valid:   ${String(summary.total - summary.invalid)}\n`);
      process.stdout.write(`Invalid: ${String(summary.invalid)}\n`);
      if (summary.invalidLines.length > 0) {
        process.stdout.write(`Invalid lines: ${summary.invalidLines.join(", ")}\n`);
      }
      if (options.minTokens !== undefined) {
        const minTok = options.minTokens;
        let records: JsonlRecord[];
        try {
          records = readJsonl(file);
        } catch {
          records = [];
        }
        const short = records.filter(
          (r) => (r.prompt.length + r.completion.length) / 4 < minTok,
        );
        if (short.length > 0) {
          process.stderr.write(
            `Warning: ${String(short.length)} record(s) below ${String(minTok)} token threshold\n`,
          );
        }
      }
      if (summary.invalid > 0) {
        process.exit(1);
      }
    });

  cmd
    .command("split <file>")
    .description("Split JSONL into train/eval sets")
    .option("--train-ratio <n>", "Fraction for training set (default: 0.9)", parseFloat)
    .option("--seed <n>", "Random seed (default: 42)", parseInt)
    .option("--output-dir <dir>", "Output directory (defaults to same dir as input)")
    .option("--min-tokens <n>", "Drop records below estimated token count before splitting", parseInt)
    .action(
      (
        file: string,
        options: { trainRatio?: number; seed?: number; outputDir?: string; minTokens?: number },
      ) => {
        let records: JsonlRecord[];
        try {
          records = readJsonl(file);
        } catch (err) {
          process.stderr.write(
            `Error: ${err instanceof Error ? err.message : String(err)}\n`,
          );
          process.exit(1);
        }

        if (options.minTokens !== undefined) {
          const minTok = options.minTokens;
          const before = records.length;
          records = records.filter(
            (r) => (r.prompt.length + r.completion.length) / 4 >= minTok,
          );
          const dropped = before - records.length;
          if (dropped > 0) {
            process.stderr.write(
              `Dropped ${String(dropped)} record(s) below ${String(options.minTokens)} token threshold\n`,
            );
          }
        }

        const { train, eval: evalSet } = splitRecords(records, {
          trainRatio: options.trainRatio,
          seed: options.seed,
        });

        const base = basename(file, extname(file));
        const outDir = options.outputDir ?? dirname(file);
        mkdirSync(outDir, { recursive: true });

        const trainPath = options.outputDir
          ? join(outDir, "train.jsonl")
          : join(outDir, `${base}.train.jsonl`);
        const validPath = options.outputDir
          ? join(outDir, "valid.jsonl")
          : join(outDir, `${base}.valid.jsonl`);

        writeJsonl(train, trainPath);
        writeJsonl(evalSet, validPath);

        process.stderr.write(`Train: ${String(train.length)} records → ${trainPath}\n`);
        process.stderr.write(`Eval:  ${String(evalSet.length)} records → ${validPath}\n`);
      },
    );

  cmd
    .command("stats <file>")
    .description("Show dataset statistics")
    .action((file: string) => {
      let records: JsonlRecord[];
      try {
        records = readJsonl(file);
      } catch (err) {
        process.stderr.write(
          `Error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }

      const stats = computeStats(records);
      const fmt = (n: number) => n.toFixed(1);

      process.stdout.write(`Records:     ${String(stats.count)}\n`);
      process.stdout.write(
        `Prompt tokens    mean=${fmt(stats.promptTokens.mean)}  p50=${String(stats.promptTokens.p50)}  p95=${String(stats.promptTokens.p95)}\n`,
      );
      process.stdout.write(
        `Completion tokens  mean=${fmt(stats.completionTokens.mean)}  p50=${String(stats.completionTokens.p50)}  p95=${String(stats.completionTokens.p95)}\n`,
      );
      process.stdout.write(
        `Duplicate rate:  ${(stats.duplicateRate * 100).toFixed(1)}%\n`,
      );
    });

  const config = loadConfig();
  cmd.addCommand(createDataPromptsCommand(config.adaptors_dir));

  return cmd;
}
