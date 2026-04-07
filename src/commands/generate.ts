import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, basename, isAbsolute } from "node:path";
import { runMlxBuffered, runMlxStream } from "../inference/mlx-runner.js";
import { loadConfig } from "../config/loader.js";
import { logger } from "../observability/logger.js";
import { checkMemory } from "../inference/memory-gate.js";
import { getModelEntry } from "../models/inspector.js";
import { capturePrompt } from "../adaptors/prompt-log.js";
import { cleanGeneratedOutput } from "../eval/runner.js";
import { ui, MascotSpinner, Spinner } from "../ui/index.js";

function collectStrings(val: string, acc: string[]): string[] {
  return [...acc, val];
}

export function createGenerateCommand(): Command {
  return new Command("generate")
    .description("Generate code using a local MLX model")
    .argument("<prompt>", "The prompt to generate from")
    .option("-m, --model <path>", "Path to MLX model directory")
    .option("--max-tokens <n>", "Maximum tokens to generate", "512")
    .option("--stream", "Stream tokens as they are generated")
    .option("--adaptor <name>", "Installed adaptor name to apply")
    .option("-o, --output <file>", "Write output to file instead of stdout")
    .option("--context <file>", "Prepend file to prompt (repeatable)", collectStrings, [] as string[])
    .option("--system <file>", "Load system prompt from file")
    .action(
      async (
        prompt: string,
        options: {
          model?: string;
          maxTokens: string;
          stream?: boolean;
          adaptor?: string;
          output?: string;
          context: string[];
          system?: string;
        },
      ) => {
        try {
          const config = loadConfig();
          const model = options.model ?? (config.default_model || undefined);

          if (!model) {
            ui.error(
              "no model specified. Use --model <path> or set default_model in config (coder config set default_model <path>)",
            );
            process.exit(1);
          }

          // Build final prompt with context file prepends
          let finalPrompt = prompt;
          for (const ctxFile of options.context) {
            const content = readFileSync(ctxFile, "utf8");
            finalPrompt =
              `--- context: ${basename(ctxFile)} ---\n${content}\n\n` + finalPrompt;
          }

          // Resolve adaptor path — mlx_lm --adapter-path expects the weights dir
          let adaptorPath: string | undefined;
          if (options.adaptor) {
            adaptorPath = join(config.adaptors_dir, options.adaptor, "weights");
          }

          const dryRun = process.env.CODER_DRY_RUN === "1";

          // Memory safety gate — skipped automatically when CODER_DRY_RUN=1
          const modelDir = isAbsolute(model) ? model : join(config.models_dir, model);
          if (existsSync(modelDir)) {
            const entry = getModelEntry(basename(modelDir), modelDir);
            let adaptorSize = 0;
            if (adaptorPath !== undefined && existsSync(adaptorPath)) {
              adaptorSize = statSync(adaptorPath).size;
            }
            await checkMemory(entry.diskSizeBytes, adaptorSize);
          }

          logger.logEvent({
            event: "generation_start",
            ts: new Date().toISOString(),
            model,
            adaptor: options.adaptor,
          });

          const runOptions = {
            model,
            prompt: finalPrompt,
            maxTokens: parseInt(options.maxTokens, 10),
            dryRun,
            adaptor: adaptorPath,
            systemFile: options.system,
            outputFile: options.output,
            contextFiles: options.context,
            stream: options.stream,
          };

          let result;
          if (options.stream === true && !dryRun) {
            // Show dancing mascot while waiting for first token (TTFT gap)
            const mascot = new MascotSpinner("Generating").start();
            const { stream, result: resultPromise } = runMlxStream(runOptions);
            const reader = stream.getReader();
            let firstToken = true;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (firstToken) {
                mascot.stop();
                firstToken = false;
              }
              process.stdout.write(value);
            }
            if (firstToken) mascot.stop(); // dry-run or empty output
            result = await resultPromise;
          } else {
            // Buffered mode: plain spinner while waiting
            const spinner = new Spinner("Generating").start();
            result = await runMlxBuffered(runOptions);
            spinner.stop();
            const cleaned = cleanGeneratedOutput(result.generatedText);
            if (options.output) {
              writeFileSync(options.output, cleaned);
            } else {
              process.stdout.write(cleaned + "\n");
            }
          }

          logger.logEvent({
            event: "generation_complete",
            ts: new Date().toISOString(),
            model,
            adaptor: options.adaptor,
            ttft_ms: result.ttftMs,
            tok_s: result.tokensPerSecond,
          });

          if (config.capture_prompts && options.adaptor && !dryRun) {
            const adaptorPackDir = join(config.adaptors_dir, options.adaptor);
            let adaptorVersion: string | undefined;
            const manifestPath = join(adaptorPackDir, "manifest.json");
            if (existsSync(manifestPath)) {
              try {
                const m = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
                if (typeof m.version === "string") adaptorVersion = m.version;
              } catch { /* ignore — version field is best-effort */ }
            }
            capturePrompt(prompt, adaptorPackDir, adaptorVersion);
          }

          if (result.tokensPerSecond !== undefined) {
            ui.dim(`Generation: ${String(result.tokensPerSecond)} tokens/sec`);
          }
        } catch (err) {
          ui.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );
}
