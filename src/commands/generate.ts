import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, basename, isAbsolute } from "node:path";
import { runMlxBuffered, runMlxStream } from "../inference/mlx-runner.js";
import { loadConfig } from "../config/loader.js";
import { logger } from "../observability/logger.js";
import { checkMemory } from "../inference/memory-gate.js";
import { getModelEntry } from "../models/inspector.js";

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
            process.stderr.write(
              "Error: no model specified. Use --model <path> or set default_model in config (coder config set default_model <path>)\n",
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
            const { stream, result: resultPromise } = runMlxStream(runOptions);
            const reader = stream.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              process.stdout.write(value);
            }
            result = await resultPromise;
          } else {
            result = await runMlxBuffered(runOptions);
            if (options.output) {
              writeFileSync(options.output, result.generatedText);
            } else {
              process.stdout.write(result.generatedText + "\n");
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

          if (result.tokensPerSecond !== undefined) {
            process.stderr.write(
              `Generation: ${String(result.tokensPerSecond)} tokens/sec\n`,
            );
          }
        } catch (err) {
          process.stderr.write(
            `Error: ${err instanceof Error ? err.message : String(err)}\n`,
          );
          process.exit(1);
        }
      },
    );
}

