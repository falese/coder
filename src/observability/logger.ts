import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CoderConfig, LogLevel } from "../config/types.js";
import type { LogEvent } from "./types.js";
import { loadConfig } from "../config/loader.js";

const LEVEL_INDEX: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private readonly logPath: string;
  private readonly minLevel: LogLevel;

  constructor(config: CoderConfig) {
    mkdirSync(config.logs_dir, { recursive: true });
    this.logPath = join(config.logs_dir, "coder.log");
    this.minLevel = config.log_level;
  }

  debug(msg: string): void {
    this.write("debug", msg);
  }

  info(msg: string): void {
    this.write("info", msg);
  }

  warn(msg: string): void {
    this.write("warn", msg);
  }

  error(msg: string): void {
    this.write("error", msg);
  }

  logEvent(event: LogEvent): void {
    const level: LogLevel = event.event === "generation_complete" ? "info" : "info";
    const { ts, ...rest } = event;
    this.writeRaw(level, rest.event as string, ts, rest as Record<string, unknown>);
  }

  private write(level: LogLevel, msg: string): void {
    this.writeRaw(level, msg, new Date().toISOString(), {});
  }

  private writeRaw(
    level: LogLevel,
    msg: string,
    ts: string,
    extra: Record<string, unknown>,
  ): void {
    const line = JSON.stringify({ ts, level, msg, ...extra });
    appendFileSync(this.logPath, line + "\n");

    if (LEVEL_INDEX[level] >= LEVEL_INDEX[this.minLevel]) {
      process.stderr.write(`[${level.toUpperCase()}] ${msg}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level lazy singleton
// ---------------------------------------------------------------------------

let _instance: Logger | null = null;

function getInstance(): Logger {
  if (!_instance) _instance = new Logger(loadConfig());
  return _instance;
}

export const logger = {
  debug: (msg: string) => getInstance().debug(msg),
  info: (msg: string) => getInstance().info(msg),
  warn: (msg: string) => getInstance().warn(msg),
  error: (msg: string) => getInstance().error(msg),
  logEvent: (event: LogEvent) => getInstance().logEvent(event),
};

/** Reset the singleton for tests that need log isolation. Call in beforeEach. */
export function resetLoggerForTest(): void {
  _instance = null;
}
