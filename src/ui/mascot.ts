/**
 * MascotSpinner — "Spark" the coder bot.
 *
 * A multi-line animated ASCII mascot that dances while generation / inference
 * is running.  Falls back to plain single-line Spinner behaviour in non-TTY,
 * quiet, or dry-run mode.
 *
 * TTY mode: renders a 4-line ASCII figure + 1-line status bar.
 * On each tick the figure cycles through 6 frames and the status bar shows
 * the spinner glyph, label, and elapsed time.
 */

import { Spinner } from "./spinner.js";
import { uiCtx } from "./context.js";
import {
  cursorUp, ERASE_EOL, CLEAR_LINE, HIDE_CURSOR, SHOW_CURSOR,
  wrap, BOLD, CYAN, GREEN, RED,
} from "./ansi.js";

// ---------------------------------------------------------------------------
// "Spark" — 6-frame dancing robot.  Each frame is exactly 4 lines.
// ---------------------------------------------------------------------------
const SPARK_FRAMES: ReadonlyArray<readonly string[]> = [
  // 0 — idle / neutral
  [
    "   .─.   ",
    "  (o_o)  ",
    "   )=(   ",
    "  /   \\  ",
  ],
  // 1 — right arm up
  [
    "   .─.   ",
    "  (^_o)╱ ",
    "   )=(   ",
    "  /   \\  ",
  ],
  // 2 — both arms up
  [
    "   .─.   ",
    " ╲(^_^)╱ ",
    "   )=(   ",
    "   | |   ",
  ],
  // 3 — left arm up
  [
    "   .─.   ",
    " ╲(o_^)  ",
    "   )=(   ",
    "  /   \\  ",
  ],
  // 4 — excited
  [
    "   .─.   ",
    " ╲(◕_◕)╱ ",
    "   )=(   ",
    "  ╱   ╲  ",
  ],
  // 5 — thinking
  [
    "   .─.   ",
    "  (._.)  ",
    "   )=(   ",
    "   | |   ",
  ],
] as const;

const BODY_LINES = SPARK_FRAMES[0].length;   // 4
const TOTAL_LINES = BODY_LINES + 1;           // +1 for status bar

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const INTERVAL_MS = 120;

export class MascotSpinner extends Spinner {
  private _mascotTimer: ReturnType<typeof setInterval> | null = null;
  private _mascotFrame = 0;
  private _initialised = false;

  override start(): this {
    if (uiCtx.quiet || uiCtx.dryRun) return this;

    if (!uiCtx.isTTY) {
      // Non-TTY: delegate to parent (single-line text)
      return super.start();
    }

    // TTY: render mascot
    this._initialised = false;
    process.stderr.write(HIDE_CURSOR);
    this._renderMascot();
    this._initialised = true;
    this._mascotTimer = setInterval(() => { this._renderMascot(); }, INTERVAL_MS);
    return this;
  }

  override update(label: string): this {
    this._label = label;
    return this;
  }

  override succeed(label?: string): this {
    if (!uiCtx.isTTY) return super.succeed(label);
    this._stopMascot();
    if (uiCtx.quiet || uiCtx.dryRun) return this;
    const msg = label ?? this._label;
    process.stderr.write(`${wrap("✓", uiCtx.isTTY, BOLD, GREEN)} ${msg}\n`);
    return this;
  }

  override fail(label?: string): this {
    if (!uiCtx.isTTY) return super.fail(label);
    this._stopMascot();
    if (uiCtx.quiet || uiCtx.dryRun) return this;
    const msg = label ?? this._label;
    process.stderr.write(`${wrap("✗", uiCtx.isTTY, BOLD, RED)} ${msg}\n`);
    return this;
  }

  override stop(): this {
    if (!uiCtx.isTTY) return super.stop();
    this._stopMascot();
    return this;
  }

  // -------------------------------------------------------------------------

  private _stopMascot(): void {
    if (this._mascotTimer !== null) {
      clearInterval(this._mascotTimer);
      this._mascotTimer = null;
    }
    // Erase all mascot lines
    if (uiCtx.isTTY && this._initialised) {
      process.stderr.write(cursorUp(TOTAL_LINES));
      for (let i = 0; i < TOTAL_LINES; i++) {
        process.stderr.write(CLEAR_LINE + (i < TOTAL_LINES - 1 ? "\n" : ""));
      }
    }
    process.stderr.write(SHOW_CURSOR);
  }

  private _renderMascot(): void {
    const frame  = SPARK_FRAMES[this._mascotFrame % SPARK_FRAMES.length];
    const glyphI = this._mascotFrame % SPINNER_FRAMES.length;
    const glyph  = SPINNER_FRAMES[glyphI];
    this._mascotFrame++;

    const elapsed  = this._elapsed();
    const statusLine = `  ${wrap(glyph, uiCtx.isTTY, BOLD, CYAN)}  ${this._label}  ${elapsed}`;

    if (this._initialised) {
      // Move up to top of previously rendered block
      process.stderr.write(cursorUp(TOTAL_LINES));
    }

    for (const line of frame) {
      process.stderr.write(
        `${wrap(line, uiCtx.isTTY, BOLD, CYAN)}${ERASE_EOL}\n`,
      );
    }
    process.stderr.write(`${statusLine}${ERASE_EOL}\n`);
  }
}
