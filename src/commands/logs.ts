import { Command } from "commander";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config/loader.js";

export function createLogsCommand(): Command {
  return new Command("logs")
    .description("Stream the coder log file to stdout")
    .option("-f, --follow", "follow log output in real time (like tail -f)")
    .action(async (options: { follow?: boolean }) => {
      const config = loadConfig();
      const logPath = join(config.logs_dir, "coder.log");

      if (!existsSync(logPath)) {
        process.stderr.write(`No log file yet at ${logPath}\n`);
        return;
      }

      if (options.follow === true) {
        const proc = Bun.spawn(["tail", "-f", logPath], {
          stdout: "inherit",
          stderr: "inherit",
        });
        await proc.exited;
        return;
      }

      const text = await Bun.file(logPath).text();
      process.stdout.write(text);
    });
}
