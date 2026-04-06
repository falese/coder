import { parse, stringify } from "smol-toml";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import {
  CONFIG_KEYS,
  LOG_LEVELS,
  type CoderConfig,
  type ConfigKey,
} from "./types.js";

export { CONFIG_KEYS } from "./types.js";

export const DEFAULT_CONFIG: CoderConfig = {
  default_model: "",
  adaptors_dir: "~/.coder/adaptors",
  models_dir: "~/.coder/models",
  logs_dir: "~/.coder/logs",
  log_level: "info",
  capture_prompts: false,
};

export function resolveConfigPath(): string {
  if (process.env.CODER_CONFIG_PATH) return process.env.CODER_CONFIG_PATH;
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "coder", "config.toml");
  return join(homedir(), ".coder", "config.toml");
}

function expandPath(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function parseRaw(configPath: string): Record<string, unknown> {
  try {
    return parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    process.stderr.write(
      `Warning: could not parse ${configPath}, using defaults\n`,
    );
    return {};
  }
}

function mergeRawIntoConfig(
  raw: Record<string, unknown>,
  base: CoderConfig,
): CoderConfig {
  const config: CoderConfig = { ...base };
  for (const key of CONFIG_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    if (key === "capture_prompts") {
      if (typeof value === "boolean") config.capture_prompts = value;
      else if (value === "true") config.capture_prompts = true;
      else if (value === "false") config.capture_prompts = false;
    } else if (key === "log_level") {
      if (typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value)) {
        config.log_level = value as CoderConfig["log_level"];
      }
    } else if (typeof value === "string") {
      config[key] = value;
    }
  }
  return config;
}

export function loadConfig(): CoderConfig {
  const configPath = resolveConfigPath();

  if (!existsSync(configPath)) {
    mkdirSync(dirname(configPath), { recursive: true });
    const toWrite: Record<string, string> = {
      default_model: DEFAULT_CONFIG.default_model,
      adaptors_dir: DEFAULT_CONFIG.adaptors_dir,
      models_dir: DEFAULT_CONFIG.models_dir,
      logs_dir: DEFAULT_CONFIG.logs_dir,
      log_level: DEFAULT_CONFIG.log_level,
    };
    writeFileSync(configPath, stringify(toWrite));
    const config = { ...DEFAULT_CONFIG };
    if (process.env.CODER_MODEL) config.default_model = process.env.CODER_MODEL;
    if (
      process.env.CODER_LOG_LEVEL &&
      (LOG_LEVELS as readonly string[]).includes(process.env.CODER_LOG_LEVEL)
    ) {
      config.log_level = process.env.CODER_LOG_LEVEL as CoderConfig["log_level"];
    }
    config.adaptors_dir = expandPath(config.adaptors_dir);
    config.models_dir = expandPath(config.models_dir);
    config.logs_dir = expandPath(config.logs_dir);
    return config;
  }

  const raw = parseRaw(configPath);
  const config = mergeRawIntoConfig(raw, { ...DEFAULT_CONFIG });

  // Env overrides (highest precedence)
  if (process.env.CODER_MODEL) config.default_model = process.env.CODER_MODEL;
  if (
    process.env.CODER_LOG_LEVEL &&
    (LOG_LEVELS as readonly string[]).includes(process.env.CODER_LOG_LEVEL)
  ) {
    config.log_level = process.env.CODER_LOG_LEVEL as CoderConfig["log_level"];
  }

  config.adaptors_dir = expandPath(config.adaptors_dir);
  config.models_dir = expandPath(config.models_dir);
  config.logs_dir = expandPath(config.logs_dir);
  return config;
}

export function setConfigValue(key: ConfigKey, value: string): void {
  const configPath = resolveConfigPath();
  const raw: Record<string, string> = {
    default_model: DEFAULT_CONFIG.default_model,
    adaptors_dir: DEFAULT_CONFIG.adaptors_dir,
    models_dir: DEFAULT_CONFIG.models_dir,
    logs_dir: DEFAULT_CONFIG.logs_dir,
    log_level: DEFAULT_CONFIG.log_level,
  };

  if (existsSync(configPath)) {
    const parsed = parseRaw(configPath);
    for (const k of CONFIG_KEYS) {
      const v = parsed[k];
      if (typeof v === "string") raw[k] = v;
    }
  } else {
    mkdirSync(dirname(configPath), { recursive: true });
  }

  raw[key] = value;
  writeFileSync(configPath, stringify(raw));
}

export function getConfigValue(key: ConfigKey): string | undefined {
  const configPath = resolveConfigPath();
  const defaultVal = DEFAULT_CONFIG[key];
  const defaultStr = typeof defaultVal === "boolean" ? String(defaultVal) : defaultVal;
  if (!existsSync(configPath)) return defaultStr;
  const raw = parseRaw(configPath);
  const value = raw[key];
  if (value === undefined) return defaultStr;
  if (typeof value === "boolean") return String(value);
  return typeof value === "string" ? value : undefined;
}
