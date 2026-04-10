/**
 * Consistent terminal print helpers.
 *
 * All functions respect `uiCtx.quiet` (except `ui.out` which is data output).
 * Colours are stripped automatically when `uiCtx.isTTY` is false.
 *
 * Progress/status goes to **stderr**; data output goes to **stdout**.
 */

import { uiCtx } from "./context.js";
import { wrap, BOLD, CYAN, YELLOW, RED, GREEN, DIM, RESET } from "./ansi.js";

function stderr(msg: string): void {
  process.stderr.write(msg + "\n");
}

/** [INFO] message — cyan prefix, to stderr.  Suppressed when quiet. */
export function info(msg: string): void {
  if (uiCtx.quiet) return;
  stderr(`${wrap("[INFO]", uiCtx.isTTY, BOLD, CYAN)} ${msg}`);
}

/** [WARN] message — yellow prefix, to stderr.  Suppressed when quiet. */
export function warn(msg: string): void {
  if (uiCtx.quiet) return;
  stderr(`${wrap("[WARN]", uiCtx.isTTY, BOLD, YELLOW)} ${msg}`);
}

/** [ERROR] message — red prefix, to stderr.  Always shown (ignores quiet). */
export function error(msg: string): void {
  stderr(`${wrap("[ERROR]", uiCtx.isTTY, BOLD, RED)} ${msg}`);
}

/** ✓ message — green, to stderr.  Suppressed when quiet. */
export function success(msg: string): void {
  if (uiCtx.quiet) return;
  stderr(`${wrap("✓", uiCtx.isTTY, BOLD, GREEN)} ${msg}`);
}

/** Dim message — to stderr.  Suppressed when quiet. */
export function dim(msg: string): void {
  if (uiCtx.quiet) return;
  stderr(wrap(msg, uiCtx.isTTY, DIM));
}

/**
 * Data output — always written to **stdout**, never suppressed.
 * Use for generated code, config values, lists, etc.
 */
export function out(msg: string): void {
  process.stdout.write(msg);
}

/** Section divider — cyan dashes, to stderr.  Suppressed when quiet. */
export function divider(label?: string): void {
  if (uiCtx.quiet) return;
  if (label) {
    const dashes = "╌".repeat(3);
    const line = `${dashes} ${label} ${dashes}`;
    stderr(wrap(line, uiCtx.isTTY, BOLD, CYAN));
  } else {
    stderr(wrap("─".repeat(48), uiCtx.isTTY, DIM));
  }
}

/** Coloured score delta, e.g. "+0.042" in green or "−0.018" in red. */
export function scoreDelta(delta: number): string {
  const sign   = delta >= 0 ? "+" : "";
  const text   = `${sign}${delta.toFixed(3)}`;
  if (!uiCtx.isTTY) return text;
  const code   = delta >= 0 ? `${BOLD}${GREEN}` : `${BOLD}${RED}`;
  return `${code}${text}${RESET}`;
}
