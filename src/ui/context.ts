/**
 * UiContext — global settings for all terminal UI components.
 *
 * Initialised once at CLI startup via `initUiContext()`, then read by
 * every spinner/progress/print helper.  Tests reset via `resetUiContextForTest()`.
 */

export interface UiContext {
  /** Suppress all progress/status output (for scripting / --quiet flag). */
  quiet: boolean;
  /** Whether stderr is a real TTY (enables animations, colours, cursor moves). */
  isTTY: boolean;
  /** CODER_DRY_RUN=1 — suppress animations (process won't actually do anything). */
  dryRun: boolean;
}

const DEFAULT_CONTEXT: UiContext = {
  quiet:  false,
  isTTY:  process.stderr.isTTY === true,
  dryRun: process.env.CODER_DRY_RUN === "1",
};

// Mutable singleton — all UI components reference this object directly.
export const uiCtx: UiContext = { ...DEFAULT_CONTEXT };

/** Merge partial overrides into the singleton.  Called once at CLI startup. */
export function initUiContext(opts: Partial<UiContext>): void {
  Object.assign(uiCtx, opts);
}

/** Reset to defaults + re-detect TTY/dryRun.  For use in tests only. */
export function resetUiContextForTest(): void {
  uiCtx.quiet  = false;
  uiCtx.isTTY  = process.stderr.isTTY === true;
  uiCtx.dryRun = process.env.CODER_DRY_RUN === "1";
}
