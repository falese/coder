import { Command } from "commander";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../config/loader.js";
import { listEpisodes, loadEpisode, episodeToJsonl } from "../episodes/store.js";
import type { JsonlRecord } from "../data/types.js";

export function createEpisodesCommand(): Command {
  const cmd = new Command("episodes").description("Inspect and export captured thinking-session episodes");

  cmd
    .command("list")
    .description("List captured episodes")
    .action(() => {
      const { episodes_dir } = loadConfig();
      const episodes = listEpisodes(episodes_dir);
      if (episodes.length === 0) {
        process.stderr.write(`No episodes in ${episodes_dir}\n`);
        return;
      }
      for (const ep of episodes) {
        process.stdout.write(
          `${ep.id}  ${ep.startedAt}  turns=${String(ep.turns.length)}  threads=${String(ep.threads.length)}\n`,
        );
      }
    });

  cmd
    .command("show <id>")
    .description("Print a single episode as JSON")
    .action((id: string) => {
      const { episodes_dir } = loadConfig();
      const episode = loadEpisode(episodes_dir, id);
      if (!episode) {
        process.stderr.write(`Error: episode "${id}" not found\n`);
        process.exit(1);
      }
      process.stdout.write(JSON.stringify(episode, null, 2) + "\n");
    });

  cmd
    .command("export")
    .description("Bake episodes into {prompt, completion} JSONL for the data/train pipeline")
    .option("--all", "Export every episode (default)")
    .option("--id <id>", "Export only this episode")
    .option("-o, --output <file>", "Write JSONL to a file instead of stdout")
    .action((options: { all?: boolean; id?: string; output?: string }) => {
      const { episodes_dir } = loadConfig();

      const episodes =
        options.id !== undefined
          ? [loadEpisode(episodes_dir, options.id)].filter((e): e is NonNullable<typeof e> => e !== null)
          : listEpisodes(episodes_dir);

      if (options.id !== undefined && episodes.length === 0) {
        process.stderr.write(`Error: episode "${options.id}" not found\n`);
        process.exit(1);
      }

      const records: JsonlRecord[] = episodes.flatMap((ep) => episodeToJsonl(ep));
      const jsonl = records.map((r) => JSON.stringify(r)).join("\n") + (records.length > 0 ? "\n" : "");

      if (options.output !== undefined) {
        mkdirSync(dirname(options.output), { recursive: true });
        writeFileSync(options.output, jsonl);
        process.stderr.write(
          `Wrote ${String(records.length)} records from ${String(episodes.length)} episode(s) to ${options.output}\n`,
        );
      } else {
        process.stdout.write(jsonl);
      }
    });

  return cmd;
}
