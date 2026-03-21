import { Command } from "commander";
import { runMlx } from "../inference/mlx-runner.js";

export function createGenerateCommand(): Command {
  return new Command("generate")
    .description("Generate code using a local MLX model")
    .argument("<prompt>", "The prompt to generate from")
    .requiredOption("-m, --model <path>", "Path to MLX model directory")
    .option("--max-tokens <n>", "Maximum tokens to generate", "512")
    .action(
      async (prompt: string, options: { model: string; maxTokens: string }) => {
        try {
          const result = await runMlx({
            model: options.model,
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
