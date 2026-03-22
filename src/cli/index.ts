#!/usr/bin/env bun
import { Command } from "commander";
import { createGenerateCommand } from "../commands/generate.js";
import { createConfigCommand } from "../commands/config.js";
import { createModelsCommand } from "../commands/models.js";
import { createLogsCommand } from "../commands/logs.js";
import { createAdaptorCommand } from "../commands/adaptor.js";
import { createChatCommand } from "../commands/chat.js";
import { createDataCommand } from "../commands/data.js";

const program = new Command();

program
  .name("coder")
  .description("Local AI code generation CLI")
  .version("0.1.0");

program.addCommand(createGenerateCommand());
program.addCommand(createConfigCommand());
program.addCommand(createModelsCommand());
program.addCommand(createLogsCommand());
program.addCommand(createAdaptorCommand());
program.addCommand(createChatCommand());
program.addCommand(createDataCommand());

await program.parseAsync(process.argv);
