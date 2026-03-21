import { Command } from "commander";
import { createGenerateCommand } from "../commands/generate.js";

const program = new Command();

program
  .name("coder")
  .description("Local AI code generation CLI")
  .version("0.1.0");

program.addCommand(createGenerateCommand());

await program.parseAsync(process.argv);
