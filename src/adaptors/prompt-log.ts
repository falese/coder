import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIN_TOKENS = 20;
const MAX_TOKENS = 1500;

interface PromptLogEntry {
  prompt: string;
  ts: string;
  adaptor_version?: string;
}

function estimateTokens(text: string): number {
  return text.length / 4;
}

export function capturePrompt(
  prompt: string,
  adaptorDir: string,
  adaptorVersion?: string,
): void {
  const logFile = join(adaptorDir, "data", "prompt-log.jsonl");
  const entry: PromptLogEntry = {
    prompt,
    ts: new Date().toISOString(),
    ...(adaptorVersion !== undefined ? { adaptor_version: adaptorVersion } : {}),
  };
  appendFileSync(logFile, JSON.stringify(entry) + "\n");
}

/**
 * Load prompts for SSD sampling. Uses prompt-log.jsonl when present,
 * applying token filters and deduplication. Falls back to evalPrompts
 * when the log is absent or all entries are filtered out.
 */
export function loadSamplePrompts(
  adaptorDir: string,
  evalPrompts: string[],
): { prompts: string[]; source: "prompt-log" | "eval-fallback" } {
  const logFile = join(adaptorDir, "data", "prompt-log.jsonl");
  if (!existsSync(logFile)) {
    return { prompts: evalPrompts, source: "eval-fallback" };
  }

  const content = readFileSync(logFile, "utf-8").trim();
  if (!content) return { prompts: evalPrompts, source: "eval-fallback" };

  const raw = content
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return (JSON.parse(l) as PromptLogEntry).prompt;
      } catch {
        return null;
      }
    })
    .filter((p): p is string => p !== null);

  // Token filters
  const filtered = raw.filter((p) => {
    const tokens = estimateTokens(p);
    return tokens >= MIN_TOKENS && tokens <= MAX_TOKENS;
  });

  if (filtered.length === 0) {
    return { prompts: evalPrompts, source: "eval-fallback" };
  }

  // Exact dedup on prompt text
  const seen = new Set<string>();
  const deduped = filtered.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });

  if (deduped.length === 0) {
    return { prompts: evalPrompts, source: "eval-fallback" };
  }

  return { prompts: deduped, source: "prompt-log" };
}
