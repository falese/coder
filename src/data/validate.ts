import { readFileSync } from "node:fs";
import type { JsonlRecord } from "./types.js";

const MAX_TOKENS = 2048;

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface FileValidationSummary {
  total: number;
  invalid: number;
  invalidLines: number[];
}

export function validateRecord(record: JsonlRecord): ValidationResult {
  const errors: string[] = [];

  if (record.prompt.length === 0) {
    errors.push("prompt is empty");
  } else if (estimateTokens(record.prompt) > MAX_TOKENS) {
    errors.push(`prompt exceeds ${String(MAX_TOKENS)} tokens`);
  }

  if (record.completion.length === 0) {
    errors.push("completion is empty");
  } else if (estimateTokens(record.completion) > MAX_TOKENS) {
    errors.push(`completion exceeds ${String(MAX_TOKENS)} tokens`);
  }

  return { valid: errors.length === 0, errors };
}

export function validateFile(filePath: string): FileValidationSummary {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  let total = 0;
  const invalidLines: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;

    const lineNum = i + 1;
    total++;

    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      invalidLines.push(lineNum);
      continue;
    }

    if (
      typeof record !== "object" ||
      record === null ||
      typeof (record as Record<string, unknown>).prompt !== "string" ||
      typeof (record as Record<string, unknown>).completion !== "string"
    ) {
      invalidLines.push(lineNum);
      continue;
    }

    const result = validateRecord(record as JsonlRecord);
    if (!result.valid) {
      invalidLines.push(lineNum);
    }
  }

  return { total, invalid: invalidLines.length, invalidLines };
}
