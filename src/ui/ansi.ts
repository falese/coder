// ANSI escape code primitives.
// All color/cursor operations go through these constants so they're
// easy to strip in tests and non-TTY environments.

export const RESET     = "\x1b[0m";
export const BOLD      = "\x1b[1m";
export const DIM       = "\x1b[2m";
export const RED       = "\x1b[31m";
export const GREEN     = "\x1b[32m";
export const YELLOW    = "\x1b[33m";
export const BLUE      = "\x1b[34m";
export const MAGENTA   = "\x1b[35m";
export const CYAN      = "\x1b[36m";
export const WHITE     = "\x1b[37m";

// Cursor / line control
export const CLEAR_LINE   = "\x1b[2K\r";     // erase current line + carriage return
export const ERASE_EOL    = "\x1b[K";        // erase from cursor to end of line
export const HIDE_CURSOR  = "\x1b[?25l";
export const SHOW_CURSOR  = "\x1b[?25h";

/** Move cursor up N lines. */
export function cursorUp(n: number): string {
  return `\x1b[${String(n)}A`;
}

/**
 * Wrap `text` with the given ANSI codes and append RESET.
 * Returns the plain text unchanged when `isTTY` is false.
 */
export function wrap(text: string, isTTY: boolean, ...codes: string[]): string {
  if (!isTTY || codes.length === 0) return text;
  return `${codes.join("")}${text}${RESET}`;
}

/**
 * Strip all ANSI escape sequences from a string.
 * Useful for normalising test assertions.
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
}

// Sparkline bars — maps a normalised 0–1 value to a block character.
const SPARKLINE_BARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

/**
 * Render an array of numbers as a sparkline string using block characters.
 * All values are normalised to the range [min, max] within the array.
 * Returns an empty string for an empty input.
 */
export function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  return values
    .map((v) => {
      if (range === 0) return SPARKLINE_BARS[0];
      const idx = Math.min(
        SPARKLINE_BARS.length - 1,
        Math.floor(((v - min) / range) * SPARKLINE_BARS.length),
      );
      return SPARKLINE_BARS[idx];
    })
    .join("");
}
