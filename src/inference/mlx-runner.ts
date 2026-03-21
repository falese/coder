import type { GenerateOptions, GenerateResult } from "./types.js";

/**
 * Parse raw stdout from `mlx_lm.generate`.
 *
 * Expected format:
 *   ==========
 *   Prompt: <echo>
 *   <generated text>
 *   ==========
 *   Prompt: N tokens, Generation: M tokens/sec
 */
export function parseMlxOutput(raw: string): GenerateResult {
  const parts = raw.split("==========");

  if (parts.length < 2) {
    return { generatedText: raw.trim() };
  }

  // parts[1] = "\nPrompt: <echo>\n<generated text>\n"
  const lines = parts[1].split("\n");
  // lines[0] = "" (leading newline), lines[1] = "Prompt: ...", rest = text
  const textLines = lines.slice(2, -1);
  const generatedText = textLines.join("\n");

  let tokensPerSecond: number | undefined;
  if (parts.length >= 3 && parts[2].trim()) {
    const match = parts[2].match(/Generation:\s*([\d.]+)\s*tokens\/sec/);
    if (match) {
      tokensPerSecond = parseFloat(match[1]);
    }
  }

  return { generatedText, tokensPerSecond };
}

export async function runMlx(options: GenerateOptions): Promise<GenerateResult> {
  if (options.dryRun === true) {
    return { generatedText: `# dry-run: ${options.prompt}` };
  }

  const maxTokens = options.maxTokens ?? 512;

  const proc = Bun.spawn(
    [
      "python",
      "-m",
      "mlx_lm.generate",
      "--model",
      options.model,
      "--prompt",
      options.prompt,
      "--max-tokens",
      String(maxTokens),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    if (stderr.includes("No module named mlx_lm")) {
      throw new Error("mlx_lm not installed. Run: pip install mlx-lm");
    }
    if (stderr.includes("No such file or directory")) {
      throw new Error(`Model not found at path: ${options.model}`);
    }
    throw new Error(stderr || `Process exited with code ${String(exitCode)}`);
  }

  return parseMlxOutput(stdout);
}
