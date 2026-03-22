import { logger } from "../observability/logger.js";

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export function formatPrompt(history: Turn[]): string {
  if (history.length === 0) return "";
  const turns = history
    .map((t) => `<|im_start|>${t.role}\n${t.content}<|im_end|>`)
    .join("\n");
  return `${turns}\n<|im_start|>assistant`;
}

export function estimateTokens(history: Turn[]): number {
  const totalChars = history.reduce((sum, t) => sum + t.content.length, 0);
  return Math.floor(totalChars / 4);
}

export function applyWindow(history: Turn[], maxTokens = 6000): Turn[] {
  if (estimateTokens(history) <= maxTokens) return history;

  logger.warn(
    `Chat history (${String(estimateTokens(history))} tokens) exceeds ${String(maxTokens)}-token window — truncating oldest turns`,
  );

  // Drop turns from the front until we fit, but always keep at least the last turn
  let result = [...history];
  while (result.length > 1 && estimateTokens(result) > maxTokens) {
    result = result.slice(1);
  }
  return result;
}
