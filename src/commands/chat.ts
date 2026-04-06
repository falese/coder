import { Command } from "commander";
import * as readline from "node:readline";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config/loader.js";
import { runMlxStream } from "../inference/mlx-runner.js";
import { logger } from "../observability/logger.js";
import { formatPrompt, applyWindow } from "../chat/history.js";
import type { Turn } from "../chat/history.js";
import { capturePrompt } from "../adaptors/prompt-log.js";

export function createChatCommand(): Command {
  return new Command("chat")
    .description("Interactive multi-turn code generation REPL")
    .option("-m, --model <path>", "Path to MLX model directory")
    .option("--adaptor <name>", "Installed adaptor name to apply")
    .action(
      async (options: { model?: string; adaptor?: string }) => {
        const config = loadConfig();
        const model = options.model ?? (config.default_model || undefined);

        if (!model) {
          process.stderr.write(
            "Error: no model specified. Use --model <path> or set default_model in config.\n",
          );
          process.exit(1);
        }

        let systemFile: string | undefined;
        if (options.adaptor) {
          const adaptorDir = join(config.adaptors_dir, options.adaptor);
          const systemPromptPath = join(adaptorDir, "prompts", "system.md");
          if (existsSync(systemPromptPath)) {
            systemFile = systemPromptPath;
          }
        }

        const history: Turn[] = [];
        const dryRun = process.env.CODER_DRY_RUN === "1";

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          terminal: process.stdin.isTTY,
          prompt: "> ",
        });

        process.stdout.write("coder chat — type /exit or Ctrl-D to quit\n");
        rl.prompt();

        let cancelCurrentStream: (() => void) | null = null;

        process.on("SIGINT", () => {
          if (cancelCurrentStream !== null) {
            cancelCurrentStream();
            cancelCurrentStream = null;
            process.stdout.write("\n");
            rl.prompt();
          }
        });

        for await (const line of rl) {
          const trimmed = line.trim();

          if (trimmed === "/exit") break;

          if (trimmed === "/clear") {
            history.length = 0;
            process.stdout.write("History cleared.\n");
            rl.prompt();
            continue;
          }

          if (trimmed.startsWith("/save ")) {
            const filePath = trimmed.slice(6).trim();
            writeFileSync(filePath, JSON.stringify(history, null, 2));
            process.stdout.write(`Saved to ${filePath}\n`);
            rl.prompt();
            continue;
          }

          if (trimmed === "") {
            rl.prompt();
            continue;
          }

          history.push({ role: "user", content: trimmed });

          if (config.capture_prompts && options.adaptor) {
            const adaptorDir = join(config.adaptors_dir, options.adaptor);
            capturePrompt(trimmed, adaptorDir);
          }

          const windowedHistory = applyWindow(history);
          const prompt = formatPrompt(windowedHistory);

          logger.logEvent({
            event: "generation_start",
            ts: new Date().toISOString(),
            model,
            adaptor: options.adaptor,
          });

          const { stream, result } = runMlxStream({
            model,
            prompt,
            dryRun,
            systemFile,
            rawPrompt: true,
          });

          const reader = stream.getReader();
          cancelCurrentStream = () => { reader.cancel().catch(() => undefined); };
          let assistantResponse = "";

          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              // Strip chat end tokens before printing
              const chunk = value.replace(/<\|im_end\|>/g, "").replace(/!\[\]<\|im_end\|>/g, "");
              process.stdout.write(chunk);
              assistantResponse += chunk;
            }
            process.stdout.write("\n");
          } catch {
            // Cancelled via SIGINT
            cancelCurrentStream = null;
            rl.prompt();
            continue;
          }

          cancelCurrentStream = null;

          try {
            const finalResult = await result;
            logger.logEvent({
              event: "generation_complete",
              ts: new Date().toISOString(),
              model,
              adaptor: options.adaptor,
              ttft_ms: finalResult.ttftMs,
              tok_s: finalResult.tokensPerSecond,
            });
          } catch {
            // ignore result errors after stream consumed
          }

          history.push({ role: "assistant", content: assistantResponse });
          rl.prompt();
        }

        rl.close();
        process.exit(0);
      },
    );
}
