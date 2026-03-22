import {
  writeFileSync,
  appendFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkPreflight } from "../inference/mlx-runner.js";
import { logger } from "../observability/logger.js";
import { generateLoraYaml } from "./config.js";
import type { TrainConfig } from "./config.js";

export function parseLossLine(
  line: string,
): { iter: number; loss: number } | null {
  const m = /Iter\s+(\d+):\s+train loss\s+([\d.]+)/.exec(line);
  if (!m) return null;
  return { iter: parseInt(m[1], 10), loss: parseFloat(m[2]) };
}

export function bumpPatchVersion(version: string): string {
  const parts = version.split(".");
  parts[2] = String(parseInt(parts[2], 10) + 1);
  return parts.join(".");
}

export function buildTrainArgs(config: TrainConfig, yamlPath: string): string[] {
  const args = [
    "python3",
    "-m",
    "mlx_lm.lora",
    "--train",
    "--model",
    config.model.path,
    "--data",
    config.data.dir,
    "--iters",
    String(config.lora.iters),
    "--batch-size",
    String(config.lora.batch_size),
    "--learning-rate",
    String(config.lora.learning_rate),
    "--adapter-path",
    config.output.adaptor_dir,
    "--mask-prompt",
    "--grad-checkpoint",
    "-c",
    yamlPath,
  ];

  const checkpoint = join(config.output.adaptor_dir, "adaptor.safetensors");
  if (existsSync(checkpoint)) {
    args.push("--resume-adapter-file", checkpoint);
  }

  return args;
}

export function updateManifestVersion(manifestPath: string): void {
  if (!existsSync(manifestPath)) return;
  const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
  const currentVersion = typeof raw.version === "string" ? raw.version : "0.0.0";
  raw.version = bumpPatchVersion(currentVersion);
  writeFileSync(manifestPath, JSON.stringify(raw, null, 2) + "\n");
}

export async function runMlxTrain(
  config: TrainConfig,
  dryRun: boolean,
): Promise<void> {
  mkdirSync(config.output.adaptor_dir, { recursive: true });

  if (dryRun) {
    const stub = join(config.output.adaptor_dir, "adaptor.safetensors");
    writeFileSync(stub, "# dry-run stub\n");
    logger.logEvent({
      event: "training_complete",
      ts: new Date().toISOString(),
      model: config.model.path,
      adaptor_dir: config.output.adaptor_dir,
    });
    return;
  }

  await checkPreflight();

  const yaml = generateLoraYaml(config);
  const yamlPath = join(tmpdir(), `coder-lora-${String(Date.now())}.yaml`);
  writeFileSync(yamlPath, yaml);

  const args = buildTrainArgs(config, yamlPath);
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });

  // Stream stdout line by line, parse loss events
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let finalLoss: number | undefined;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    lineBuffer += decoder.decode(value);

    // Process complete lines
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      process.stderr.write(line + "\n");
      const parsed = parseLossLine(line);
      if (parsed) {
        finalLoss = parsed.loss;
        const entry = JSON.stringify({
          ts: new Date().toISOString(),
          event: "training_step",
          iter: parsed.iter,
          loss: parsed.loss,
          model: config.model.path,
        });
        mkdirSync(
          config.output.log_file.includes("/")
            ? config.output.log_file.slice(0, config.output.log_file.lastIndexOf("/"))
            : ".",
          { recursive: true },
        );
        appendFileSync(config.output.log_file, entry + "\n");
      }
    }
  }

  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Clean up temp YAML
  try {
    rmSync(yamlPath);
  } catch {
    // ignore cleanup errors
  }

  if (exitCode !== 0) {
    throw new Error(
      stderr.trim() || `Training process exited with code ${String(exitCode)}`,
    );
  }

  updateManifestVersion(config.output.manifest);

  logger.logEvent({
    event: "training_complete",
    ts: new Date().toISOString(),
    model: config.model.path,
    adaptor_dir: config.output.adaptor_dir,
    final_loss: finalLoss,
  });
}
