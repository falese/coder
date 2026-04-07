#!/usr/bin/env bun
import { Command } from "commander";
import { createGenerateCommand } from "../commands/generate.js";
import { createConfigCommand } from "../commands/config.js";
import { createModelsCommand } from "../commands/models.js";
import { createLogsCommand } from "../commands/logs.js";
import { createAdaptorCommand } from "../commands/adaptor.js";
import { createChatCommand } from "../commands/chat.js";
import { createDataCommand } from "../commands/data.js";
import { initUiContext } from "../ui/index.js";

const program = new Command();

program
  .name("coder")
  .description("Local AI code generation CLI")
  .version("0.1.0")
  .option("-q, --quiet", "Suppress all progress output (for scripting)");

// Initialise UiContext before any subcommand action runs.
program.hook("preAction", (root) => {
  const opts = root.opts<{ quiet?: boolean }>();
  initUiContext({ quiet: opts.quiet === true });
});

program.addCommand(createGenerateCommand());
program.addCommand(createConfigCommand());
program.addCommand(createModelsCommand());
program.addCommand(createLogsCommand());
program.addCommand(createAdaptorCommand());
program.addCommand(createChatCommand());
program.addCommand(createDataCommand());

await program.parseAsync(process.argv);
