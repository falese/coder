import { Command } from "commander";
import { existsSync, statSync } from "node:fs";
import { join, basename, isAbsolute } from "node:path";
import { loadConfig } from "../config/loader.js";
import { logger } from "../observability/logger.js";
import { checkMemory } from "../inference/memory-gate.js";
import { getModelEntry } from "../models/inspector.js";
import { startServer } from "../serve/start.js";
import { createSessionRecorder } from "../episodes/recorder.js";
import type { ServeContext } from "../serve/server.js";

/** Flush idle episodes every 30s; a session is idle after 5 min of silence. */
const IDLE_SWEEP_MS = 30_000;
const IDLE_TIMEOUT_MS = 5 * 60_000;

export function createServeCommand(): Command {
  return new Command("serve")
    .description("Run a local SSE inference server over the MLX runtime")
    .option("-p, --port <port>", "Port to listen on")
    .option("-m, --model <path>", "Path to MLX model directory")
    .option("--adaptor <name>", "Installed adaptor name to apply")
    .action(
      async (options: { port?: string; model?: string; adaptor?: string }) => {
        try {
          const config = loadConfig();
          const model = options.model ?? (config.default_model || "");
          const port = options.port
            ? parseInt(options.port, 10)
            : parseInt(config.port, 10);

          const dryRun = process.env.CODER_DRY_RUN === "1";

          // Resolve adaptor (flag wins, else config default).
          const adaptorName = options.adaptor ?? (config.default_adaptor || undefined);
          // mlx_lm --adapter-path expects the weights dir; capture targets the pack root.
          let adaptorPath: string | undefined;
          let adaptorPackDir: string | undefined;
          if (adaptorName) {
            adaptorPackDir = join(config.adaptors_dir, adaptorName);
            adaptorPath = join(adaptorPackDir, "weights");
          }

          if (!model) {
            process.stderr.write(
              "Warning: no model configured. /generate will return 400 until --model or default_model is set.\n",
            );
          }

          // Memory safety gate — fail fast before accepting connections.
          // Skipped automatically when CODER_DRY_RUN=1.
          if (model) {
            const modelDir = isAbsolute(model)
              ? model
              : join(config.models_dir, model);
            if (existsSync(modelDir)) {
              const entry = getModelEntry(basename(modelDir), modelDir);
              let adaptorSize = 0;
              if (adaptorPath !== undefined && existsSync(adaptorPath)) {
                adaptorSize = statSync(adaptorPath).size;
              }
              await checkMemory(entry.diskSizeBytes, adaptorSize);
            }
          }

          const recorder = createSessionRecorder({
            dir: config.episodes_dir,
            model,
            ...(adaptorName !== undefined ? { adaptor: adaptorName } : {}),
          });

          const ctx: ServeContext = {
            model,
            adaptorPath,
            dryRun,
            capturePrompts: config.capture_prompts,
            adaptorPackDir,
            recorder,
          };
          const server = startServer(ctx, port);

          // Idle-timeout fallback: persist sessions abandoned without an explicit
          // POST /episodes/save so a thinking session is never silently lost.
          const idleSweep = setInterval(() => {
            const flushed = recorder.flushIdle(Date.now(), IDLE_TIMEOUT_MS);
            for (const ep of flushed) {
              logger.logEvent({
                event: "episode_saved",
                ts: new Date().toISOString(),
                id: ep.id,
                turns: ep.turns.length,
                threads: ep.threads.length,
                trigger: "idle",
              });
            }
          }, IDLE_SWEEP_MS);

          logger.logEvent({
            event: "server_start",
            ts: new Date().toISOString(),
            model,
            port: server.port,
            adaptor: adaptorName,
          });

          process.stderr.write(
            `coder serve listening on http://localhost:${String(server.port)} (model: ${model || "none"})\n`,
          );

          const shutdown = (): void => {
            clearInterval(idleSweep);
            // Persist any open sessions before exit.
            for (const ep of recorder.flushAll()) {
              logger.logEvent({
                event: "episode_saved",
                ts: new Date().toISOString(),
                id: ep.id,
                turns: ep.turns.length,
                threads: ep.threads.length,
                trigger: "shutdown",
              });
            }
            server.stop();
            process.exit(0);
          };
          process.on("SIGINT", shutdown);
          process.on("SIGTERM", shutdown);
        } catch (err) {
          process.stderr.write(
            `Error: ${err instanceof Error ? err.message : String(err)}\n`,
          );
          process.exit(1);
        }
      },
    );
}
