export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface CoderConfig {
  default_model: string;
  default_adaptor: string;
  adaptors_dir: string;
  models_dir: string;
  logs_dir: string;
  log_level: LogLevel;
  port: string;
  capture_prompts: boolean;
}

export const CONFIG_KEYS = [
  "default_model",
  "default_adaptor",
  "adaptors_dir",
  "models_dir",
  "logs_dir",
  "log_level",
  "port",
  "capture_prompts",
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];
