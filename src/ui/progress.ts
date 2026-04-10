/**
 * Progress indicators for long-running operations.
 *
 * ByteProgress  — file download with speed (MB/s) and ETA.
 * StepProgress  — N-of-M loop with a fill bar (e.g. eval prompts).
 *
 * Both:
 *   - Write to stderr using carriage-return (\r) for in-place updates in TTY.
 *   - Print each step on its own line in non-TTY mode (no cursor tricks).
 *   - Are silent when `uiCtx.quiet` is true.
 */

import { uiCtx } from "./context.js";
import { wrap, BOLD, GREEN, CYAN, DIM, RESET, ERASE_EOL } from "./ansi.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function renderBar(ratio: number, width = 20): string {
  const filled = Math.round(ratio * width);
  const empty  = width - filled;
  return (
    wrap("█".repeat(filled), uiCtx.isTTY, BOLD, GREEN) +
    wrap("░".repeat(empty), uiCtx.isTTY, DIM)
  );
}

// ---------------------------------------------------------------------------
// ByteProgress
// ---------------------------------------------------------------------------

export class ByteProgress {
  private _filename: string;
  private _startMs: number;
  /** Ring-buffer of (timestamp, bytes) for rolling-window speed calc. */
  private _window: Array<[number, number]> = [];

  constructor(filename: string) {
    this._filename = filename;
    this._startMs  = Date.now();
  }

  /** Call each time a chunk arrives. `total` = 0 means unknown. */
  update(received: number, total: number): void {
    if (uiCtx.quiet) return;

    const now = Date.now();
    this._window.push([now, received]);
    // Keep ~2 s of history
    const cutoff = now - 2000;
    while (this._window.length > 1 && (this._window[0]?.[0] ?? 0) < cutoff) {
      this._window.shift();
    }

    const pct    = total > 0 ? received / total : 0;
    const bar    = total > 0 ? `[${renderBar(pct)}] ` : "";
    const pctStr = total > 0 ? `${String(Math.floor(pct * 100)).padStart(3)}%  ` : "";

    // Speed over rolling window
    let speedStr = "";
    let etaStr   = "";
    if (this._window.length >= 2) {
      const oldest = this._window[0];
      const newest = this._window[this._window.length - 1];
      if (oldest && newest) {
        const dt    = (newest[0] - oldest[0]) / 1000;
        const db    = newest[1] - oldest[1];
        const bps   = dt > 0 ? db / dt : 0;
        speedStr    = `  ${formatBytes(bps)}/s`;

        if (total > 0 && bps > 0) {
          const remaining = total - received;
          const etaSec    = remaining / bps;
          etaStr = `  ETA ${etaSec < 60 ? `${Math.round(etaSec)}s` : `${Math.round(etaSec / 60)}m`}`;
        }
      }
    }

    const name = this._filename.length > 28
      ? `…${this._filename.slice(-27)}`
      : this._filename.padEnd(28);

    const line = `  ${name}  ${bar}${pctStr}${formatBytes(received)}${total > 0 ? ` / ${formatBytes(total)}` : ""}${speedStr}${etaStr}`;

    if (uiCtx.isTTY) {
      process.stderr.write(`\r${line}${ERASE_EOL}`);
    } else {
      process.stderr.write(`${line}\n`);
    }
  }

  /** Call when the file download is complete. */
  done(): void {
    if (uiCtx.quiet) return;
    const elapsed = ((Date.now() - this._startMs) / 1000).toFixed(1);
    if (uiCtx.isTTY) process.stderr.write("\n");
    process.stderr.write(
      `  ${wrap("✓", uiCtx.isTTY, BOLD, GREEN)} ${this._filename}  (${elapsed}s)\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// StepProgress
// ---------------------------------------------------------------------------

export class StepProgress {
  private _label: string;

  constructor(label: string) {
    this._label = label;
  }

  /** `current` is 1-based. */
  tick(current: number, total: number, detail?: string): void {
    if (uiCtx.quiet) return;
    const ratio   = total > 0 ? current / total : 0;
    const bar     = `[${renderBar(ratio, 16)}]`;
    const counter = `${wrap(`[${String(current)}/${String(total)}]`, uiCtx.isTTY, BOLD, CYAN)}`;
    const detailStr = detail ? `  ${wrap(detail, uiCtx.isTTY, DIM)}` : "";
    const line    = `  ${this._label} ${counter}  ${bar}  ${String(Math.round(ratio * 100))}%${detailStr}`;

    if (uiCtx.isTTY) {
      process.stderr.write(`\r${line}${ERASE_EOL}`);
    } else {
      process.stderr.write(`${line}\n`);
    }
  }

  /** Clear the progress line and print a summary. */
  done(summary: string): void {
    if (uiCtx.quiet) return;
    if (uiCtx.isTTY) process.stderr.write("\n");
    process.stderr.write(
      `  ${wrap("✓", uiCtx.isTTY, BOLD, GREEN)} ${summary}\n`,
    );
  }
}
