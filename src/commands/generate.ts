import { Command } from "commander";
import { runMlx } from "../inference/mlx-runner.js";
import { loadConfig } from "../config/loader.js";

export function createGenerateCommand(): Command {
  return new Command("generate")
    .description("Generate code using a local MLX model")
    .argument("<prompt>", "The prompt to generate from")
    .option("-m, --model <path>", "Path to MLX model directory")
    .option("--max-tokens <n>", "Maximum tokens to generate", "512")
    .action(
      async (prompt: string, options: { model?: string; maxTokens: string }) => {
        try {
          const config = loadConfig();
          const model = options.model ?? (config.default_model || undefined);

          if (!model) {
            process.stderr.write(
              "Error: no model specified. Use --model <path> or set default_model in config (coder config set default_model <path>)\n",
            );
            process.exit(1);
          }

          const result = await runMlx({
            model,
            prompt,
            maxTokens: parseInt(options.maxTokens, 10),
            dryRun: process.env.CODER_DRY_RUN === "1",
          });
          process.stdout.write(result.generatedText + "\n");
          if (result.tokensPerSecond !== undefined) {
            process.stderr.write(
              `Generation: ${String(result.tokensPerSecond)} tokens/sec\n`,
            );
          }
        } catch (err) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exit(1);
        }
      },
    );
}
