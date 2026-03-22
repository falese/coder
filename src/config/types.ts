export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface CoderConfig {
  default_model: string;
  adaptors_dir: string;
  models_dir: string;
  logs_dir: string;
  log_level: LogLevel;
}

export const CONFIG_KEYS = [
  "default_model",
  "adaptors_dir",
  "models_dir",
  "logs_dir",
  "log_level",
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];
