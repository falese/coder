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

export interface TrainingStepEvent {
  event: "training_step";
  ts: string;
  iter: number;
  loss: number;
  model: string;
}

export interface TrainingCompleteEvent {
  event: "training_complete";
  ts: string;
  model: string;
  adaptor_dir: string;
  final_loss?: number;
}

export interface EvalCompleteEvent {
  event: "eval_complete";
  ts: string;
  adaptor: string;
  composite_score: number;
  tsc_score: number;
  eslint_score: number;
  test_score: number;
  record_count: number;
}

export type LogEvent =
  | GenerationStartEvent
  | FirstTokenEvent
  | GenerationCompleteEvent
  | TrainingStepEvent
  | TrainingCompleteEvent
  | EvalCompleteEvent;

export interface LogLine {
  ts: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}
