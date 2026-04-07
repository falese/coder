/**
 * src/ui — Public API surface for the CLI terminal UX framework.
 *
 * Import from here rather than individual modules:
 *   import { Spinner, MascotSpinner, ByteProgress, StepProgress, renderTable, ui, sparkline } from "../ui/index.js";
 */

export { uiCtx, initUiContext, resetUiContextForTest } from "./context.js";
export type { UiContext } from "./context.js";

export { Spinner } from "./spinner.js";
export { MascotSpinner } from "./mascot.js";
export { ByteProgress, StepProgress } from "./progress.js";
export { renderTable } from "./table.js";
export type { TableOptions, Alignment } from "./table.js";
export { sparkline, stripAnsi, wrap } from "./ansi.js";

import * as _print from "./print.js";

/**
 * `ui` namespace — convenience accessor for all print helpers.
 *
 * Usage:
 *   import { ui } from "../ui/index.js";
 *   ui.info("Loading model...");
 *   ui.error("Not found");
 */
export const ui = {
  info:     _print.info,
  warn:     _print.warn,
  error:    _print.error,
  success:  _print.success,
  dim:      _print.dim,
  out:      _print.out,
  divider:  _print.divider,
  scoreDelta: _print.scoreDelta,
} as const;
