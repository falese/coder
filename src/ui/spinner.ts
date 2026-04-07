/**
 * Single-line animated spinner.
 *
 * TTY mode   — Braille frames tick at 80 ms; cursor hidden while running.
 * Non-TTY    — `start()` prints `label...` once; succeed/fail print result once.
 * quiet/dryRun — all methods are no-ops.
 */

import { uiCtx } from "./context.js";
import {
  CLEAR_LINE, HIDE_CURSOR, SHOW_CURSOR, ERASE_EOL,
  wrap, BOLD, GREEN, RED, CYAN,
} from "./ansi.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const INTERVAL_MS = 80;

export class Spinner {
  protected _label: string;
  private _frameIdx = 0;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _startMs = 0;

  constructor(label: string) {
    this._label = label;
  }

  get label(): string { return this._label; }

  start(): this {
    if (uiCtx.quiet || uiCtx.dryRun) return this;

    this._startMs = Date.now();

    if (uiCtx.isTTY) {
      process.stderr.write(HIDE_CURSOR);
      this._tick();
      this._timer = setInterval(() => { this._tick(); }, INTERVAL_MS);
    } else {
      process.stderr.write(`${this._label}...\n`);
    }
    return this;
  }

  update(label: string): this {
    this._label = label;
    return this;
  }

  succeed(label?: string): this {
    this._stop();
    if (uiCtx.quiet || uiCtx.dryRun) return this;
    const msg = label ?? this._label;
    process.stderr.write(`${wrap("✓", uiCtx.isTTY, BOLD, GREEN)} ${msg}\n`);
    return this;
  }

  fail(label?: string): this {
    this._stop();
    if (uiCtx.quiet || uiCtx.dryRun) return this;
    const msg = label ?? this._label;
    process.stderr.write(`${wrap("✗", uiCtx.isTTY, BOLD, RED)} ${msg}\n`);
    return this;
  }

  stop(): this {
    this._stop();
    if (uiCtx.isTTY && !uiCtx.quiet && !uiCtx.dryRun) {
      process.stderr.write(CLEAR_LINE);
    }
    return this;
  }

  protected _stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (uiCtx.isTTY) {
      process.stderr.write(SHOW_CURSOR);
      process.stderr.write(CLEAR_LINE);
    }
  }

  protected _elapsed(): string {
    const ms = Date.now() - this._startMs;
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${String(ms)}ms`;
  }

  private _tick(): void {
    const frame = FRAMES[this._frameIdx % FRAMES.length];
    this._frameIdx++;
    const elapsed = this._elapsed();
    const line = `${wrap(frame, uiCtx.isTTY, BOLD, CYAN)}  ${this._label}  ${elapsed}${ERASE_EOL}`;
    process.stderr.write(`\r${line}`);
  }
}
