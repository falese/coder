import type { LogLevel } from "../config/types.js";

export type { LogLevel };

export interface GenerationStartEvent {
  event: "generation_start";
  ts: string;
  model: string;
  adaptor?: string;
}

export interface FirstTokenEvent {
  event: "first_token";
  ts: string;
  ttft_ms: number;
}

export interface GenerationCompleteEvent {
  event: "generation_complete";
  ts: string;
  ttft_ms?: number;
  tok_s?: number;
  tokens?: number;
  model: string;
  adaptor?: string;
}

export type LogEvent =
  | GenerationStartEvent
  | FirstTokenEvent
  | GenerationCompleteEvent;

export interface LogLine {
  ts: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}
