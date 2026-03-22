import type { GenerateOptions, GenerateResult } from "./types.js";

// ---------------------------------------------------------------------------
// Preflight check — cached per process, skipped when CODER_DRY_RUN=1
// ---------------------------------------------------------------------------

let preflightDone = false;

export async function checkPreflight(): Promise<void> {
  if (preflightDone || process.env.CODER_DRY_RUN === "1") return;
  const proc = Bun.spawn(["python3", "-c", "import mlx_lm"], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    if (stderr.includes("No module named mlx_lm")) {
      throw new Error("mlx_lm not installed. Run: pip install mlx-lm");
    }
    throw new Error(
      "python3 not found. Install Python 3.x from https://python.org",
    );
  }
  preflightDone = true;
}

export function resetPreflightForTest(): void {
  preflightDone = false;
}

export function markPreflightDoneForTest(): void {
  preflightDone = true;
}

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

function buildSpawnArgs(options: GenerateOptions): string[] {
  const maxTokens = options.maxTokens ?? 512;
  const args = [
    "python3",
    "-m",
    "mlx_lm.generate",
    "--model",
    options.model,
    "--prompt",
    options.prompt,
    "--max-tokens",
    String(maxTokens),
  ];
  if (options.adaptor !== undefined) {
    args.push("--adapter-path", options.adaptor);
  }
  if (options.systemFile !== undefined) {
    args.push("--system-prompt", options.systemFile);
  }
  if (options.rawPrompt === true) {
    args.push("--ignore-chat-template");
  }
  return args;
}

function handleNonZeroExit(stderr: string, exitCode: number): never {
  if (stderr.includes("No module named mlx_lm")) {
    throw new Error("mlx_lm not installed. Run: pip install mlx-lm");
  }
  if (stderr.includes("No such file or directory")) {
    throw new Error(`Model not found at path`);
  }
  throw new Error(stderr || `Process exited with code ${String(exitCode)}`);
}

async function readChunks(
  stream: ReadableStream<Uint8Array>,
  onChunk: (chunk: string, isFirst: boolean) => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let seenNonEmpty = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    const isFirst = !seenNonEmpty && chunk.trim().length > 0;
    if (isFirst) seenNonEmpty = true;
    onChunk(chunk, isFirst);
    raw += chunk;
  }

  return raw;
}

export async function runMlxBuffered(options: GenerateOptions): Promise<GenerateResult> {
  if (options.dryRun === true) {
    return { generatedText: `# dry-run: ${options.prompt}` };
  }

  await checkPreflight();

  const spawnTime = Date.now();
  const proc = Bun.spawn(buildSpawnArgs(options), { stdout: "pipe", stderr: "pipe" });

  let ttftMs: number | undefined;

  const rawOutput = await readChunks(proc.stdout, (_chunk, isFirst) => {
    if (isFirst) ttftMs = Date.now() - spawnTime;
  });

  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    handleNonZeroExit(stderr, exitCode);
  }

  const result = parseMlxOutput(rawOutput);
  return { ...result, ttftMs };
}

async function processStream(
  options: GenerateOptions,
  controller: ReadableStreamDefaultController<string>,
  resolve: (r: GenerateResult) => void,
  reject: (e: unknown) => void,
): Promise<void> {
  await checkPreflight();

  const spawnTime = Date.now();
  const proc = Bun.spawn(buildSpawnArgs(options), { stdout: "pipe", stderr: "pipe" });

  let ttftMs: number | undefined;

  try {
    const rawOutput = await readChunks(proc.stdout, (chunk, isFirst) => {
      if (isFirst) ttftMs = Date.now() - spawnTime;
      controller.enqueue(chunk);
    });
    controller.close();

    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      reject(
        new Error(
          stderr.includes("No module named mlx_lm")
            ? "mlx_lm not installed. Run: pip install mlx-lm"
            : stderr.includes("No such file or directory")
              ? `Model not found at path`
              : stderr || `Process exited with code ${String(exitCode)}`,
        ),
      );
      return;
    }

    const result = parseMlxOutput(rawOutput);
    resolve({ ...result, ttftMs });
  } catch (e) {
    controller.error(e);
    reject(e);
  }
}

export function runMlxStream(options: GenerateOptions): {
  stream: ReadableStream<string>;
  result: Promise<GenerateResult>;
} {
  if (options.dryRun === true) {
    const text = `# dry-run: ${options.prompt}`;
    return {
      stream: new ReadableStream<string>({
        start(controller) {
          controller.enqueue(text);
          controller.close();
        },
      }),
      result: Promise.resolve({ generatedText: text }),
    };
  }

  let resolveResult!: (r: GenerateResult) => void;
  let rejectResult!: (e: unknown) => void;
  const result = new Promise<GenerateResult>((res, rej) => {
    resolveResult = res;
    rejectResult = rej;
  });

  const stream = new ReadableStream<string>({
    start(controller): Promise<void> {
      return processStream(options, controller, resolveResult, rejectResult);
    },
  });

  return { stream, result };
}

// Backward-compatible alias — existing callers import { runMlx }
export { runMlxBuffered as runMlx };
