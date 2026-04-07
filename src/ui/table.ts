/**
 * Consistent table renderer.
 *
 * Replaces the hand-rolled `.padEnd()` pattern used across commands.
 * Returns a fully-formed string (caller writes it to stdout/stderr).
 *
 * Headers are rendered in bold when isTTY.
 * A `─` separator row is drawn under the headers.
 * Numeric columns are right-aligned; all others are left-aligned.
 */

import { uiCtx } from "./context.js";
import { wrap, BOLD, DIM, RESET } from "./ansi.js";

export type Alignment = "left" | "right";

export interface TableOptions {
  /** Explicit column widths.  If omitted, derived from content. */
  widths?: number[];
  /** Per-column alignment.  Defaults to "left". */
  align?: Alignment[];
}

/**
 * Render a table to a string.
 *
 * @param headers  Column header labels.
 * @param rows     Data rows.  Each inner array must have the same length as `headers`.
 * @param opts     Optional column widths and alignment.
 */
export function renderTable(
  headers: string[],
  rows: string[][],
  opts: TableOptions = {},
): string {
  const colCount = headers.length;

  // Compute column widths
  const widths: number[] = headers.map((h, i) => {
    if (opts.widths?.[i] !== undefined) return opts.widths[i];
    const maxData = rows.reduce((m, row) => Math.max(m, (row[i] ?? "").length), 0);
    return Math.max(h.length, maxData);
  });

  const align: Alignment[] = headers.map((_, i) => opts.align?.[i] ?? "left");

  function pad(text: string, width: number, a: Alignment): string {
    if (a === "right") return text.padStart(width);
    return text.padEnd(width);
  }

  const lines: string[] = [];

  // Header row
  const headerCells = headers.map((h, i) =>
    wrap(pad(h, widths[i], align[i]), uiCtx.isTTY, BOLD),
  );
  lines.push("  " + headerCells.join("  "));

  // Separator
  const sepCells = widths.map((w) => wrap("─".repeat(w), uiCtx.isTTY, DIM));
  lines.push("  " + sepCells.join("  "));

  // Data rows
  for (const row of rows) {
    const cells = headers.map((_, i) =>
      pad(row[i] ?? "", widths[i], align[i]),
    );
    lines.push("  " + cells.join("  "));
  }

  return lines.join("\n") + "\n";
}
