import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PromptEntry {
  prompt: string;
  ts: string;
  adaptor_version?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return text.length / 4;
}

function readLog(logFile: string): PromptEntry[] {
  const content = readFileSync(logFile, "utf-8").trim();
  if (!content) return [];
  return content
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as PromptEntry);
}

function writeLog(logFile: string, entries: PromptEntry[]): void {
  writeFileSync(logFile, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

function requireLog(logFile: string): void {
  if (!existsSync(logFile)) {
    process.stderr.write(`Error: prompt-log.jsonl not found at ${logFile}\n`);
    process.exit(1);
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  return sorted[idx];
}

// ---------------------------------------------------------------------------
// Command factory
// ---------------------------------------------------------------------------

export function createDataPromptsCommand(adaptorsDir: string): Command {
  const cmd = new Command("prompts").description("Manage the SSD prompt log");

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------
  cmd
    .command("list")
    .description("Print all captured prompts with timestamps")
    .requiredOption("--adaptor <name>", "Adaptor name")
    .action((options: { adaptor: string }) => {
      const logFile = join(adaptorsDir, options.adaptor, "data", "prompt-log.jsonl");
      requireLog(logFile);

      const entries = readLog(logFile);
      for (const entry of entries) {
        const display = entry.prompt.length > 80
          ? entry.prompt.slice(0, 80) + "…"
          : entry.prompt;
        process.stdout.write(`[${entry.ts}] ${display}\n`);
      }
    });

  // -------------------------------------------------------------------------
  // stats
  // -------------------------------------------------------------------------
  cmd
    .command("stats")
    .description("Show token distribution and duplicate rate for the prompt log")
    .requiredOption("--adaptor <name>", "Adaptor name")
    .action((options: { adaptor: string }) => {
      const logFile = join(adaptorsDir, options.adaptor, "data", "prompt-log.jsonl");
      requireLog(logFile);

      const entries = readLog(logFile);
      const total = entries.length;
      const unique = new Set(entries.map((e) => e.prompt)).size;

      const tokens = entries
        .map((e) => Math.round(estimateTokens(e.prompt)))
        .sort((a, b) => a - b);

      const min = tokens[0] ?? 0;
      const max = tokens[tokens.length - 1] ?? 0;
      const p50 = percentile(tokens, 50);
      const p95 = percentile(tokens, 95);

      process.stdout.write(`Total prompts:   ${String(total)}\n`);
      process.stdout.write(`Unique prompts:  ${String(unique)}\n`);
      process.stdout.write(`Token estimate:  min=${String(min)}  p50=${String(p50)}  p95=${String(p95)}  max=${String(max)}\n`);
    });

  // -------------------------------------------------------------------------
  // deduplicate
  // -------------------------------------------------------------------------
  cmd
    .command("deduplicate")
    .description("Remove exact duplicate prompts from the log in-place")
    .requiredOption("--adaptor <name>", "Adaptor name")
    .action((options: { adaptor: string }) => {
      const logFile = join(adaptorsDir, options.adaptor, "data", "prompt-log.jsonl");
      requireLog(logFile);

      const entries = readLog(logFile);
      const seen = new Set<string>();
      const deduped = entries.filter((e) => {
        if (seen.has(e.prompt)) return false;
        seen.add(e.prompt);
        return true;
      });
      const removed = entries.length - deduped.length;

      writeLog(logFile, deduped);
      process.stderr.write(
        `Removed ${String(removed)} duplicate entries. ${String(deduped.length)} remaining.\n`,
      );
    });

  // -------------------------------------------------------------------------
  // purge
  // -------------------------------------------------------------------------
  cmd
    .command("purge")
    .description("Remove entries by date or token length")
    .requiredOption("--adaptor <name>", "Adaptor name")
    .option("--before <date>", "Remove entries with ts before this ISO date")
    .option("--below-tokens <n>", "Remove entries with estimated tokens below n", parseInt)
    .option("--confirm", "Apply changes (without this flag, prints a dry-run summary)")
    .action((options: { adaptor: string; before?: string; belowTokens?: number; confirm?: boolean }) => {
      const logFile = join(adaptorsDir, options.adaptor, "data", "prompt-log.jsonl");

      if (!existsSync(logFile)) {
        // purge on absent log is a no-op
        process.stderr.write(`No prompt-log.jsonl found for adaptor ${options.adaptor} — nothing to purge.\n`);
        return;
      }

      const entries = readLog(logFile);
      const beforeDate = options.before ? new Date(options.before) : null;
      const belowTokens = options.belowTokens;

      const toRemove = entries.filter((e) => {
        if (beforeDate !== null && new Date(e.ts) < beforeDate) return true;
        if (belowTokens !== undefined && estimateTokens(e.prompt) < belowTokens) return true;
        return false;
      });

      const remaining = entries.filter((e) => !toRemove.includes(e));

      if (!options.confirm) {
        const parts: string[] = [];
        if (options.before) parts.push(`older than ${options.before}`);
        if (belowTokens !== undefined) parts.push(`below ${String(belowTokens)} tokens`);
        process.stdout.write(
          `Would remove ${String(toRemove.length)} entries (${parts.join(" or ")}). Run with --confirm to apply.\n`,
        );
        return;
      }

      writeLog(logFile, remaining);
      process.stderr.write(
        `Removed ${String(toRemove.length)} entries. ${String(remaining.length)} remaining.\n`,
      );
    });

  return cmd;
}
