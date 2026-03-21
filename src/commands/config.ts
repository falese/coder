import { Command } from "commander";
import {
  loadConfig,
  setConfigValue,
  getConfigValue,
  CONFIG_KEYS,
} from "../config/loader.js";
import type { ConfigKey } from "../config/types.js";

function assertKnownKey(key: string): asserts key is ConfigKey {
  if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
    process.stderr.write(
      `Error: unknown config key "${key}". Valid keys: ${CONFIG_KEYS.join(", ")}\n`,
    );
    process.exit(1);
  }
}

export function createConfigCommand(): Command {
  const cmd = new Command("config").description("Manage coder configuration");

  cmd
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action((key: string, value: string) => {
      assertKnownKey(key);
      setConfigValue(key, value);
    });

  cmd
    .command("get <key>")
    .description("Get a configuration value")
    .action((key: string) => {
      assertKnownKey(key);
      const value = getConfigValue(key);
      process.stdout.write((value ?? "") + "\n");
    });

  cmd
    .command("show")
    .description("Print the full resolved configuration")
    .action(() => {
      const config = loadConfig();
      for (const key of CONFIG_KEYS) {
        process.stdout.write(`${key} = ${config[key]}\n`);
      }
    });

  return cmd;
}
