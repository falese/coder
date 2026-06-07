const SEP = "==========";
// Chat-template / special tokens like <|im_end|>, <|endoftext|>, <|im_start|>.
const SPECIAL_TOKEN = /<\|[^|]*\|>/g;

/**
 * Clean the cumulative raw stdout of `mlx_lm.generate` down to just the
 * generated text, for streaming over SSE.
 *
 * mlx_lm frames output as:
 *   ==========
 *   [Prompt: <echo>]        (older format only)
 *   <generated text>
 *   ==========
 *   Prompt: N tokens, ...   (stats — dropped)
 *   Generation: N tokens, ...
 *
 * Given the raw accumulated so far (which may be mid-stream and have no closing
 * separator yet), return the generated text seen up to this point with the
 * leading banner/echo, trailing stats block, and special tokens removed. Text
 * with no separator (e.g. dry-run output) is returned as-is, minus special
 * tokens. Total function — never throws.
 */
export function cleanMlxText(raw: string): string {
  const first = raw.indexOf(SEP);
  if (first === -1) {
    return raw.replace(SPECIAL_TOKEN, "");
  }

  let section = raw.slice(first + SEP.length);
  const close = section.indexOf(SEP);
  const closed = close !== -1;
  if (closed) section = section.slice(0, close);

  // Drop the leading newline after the opening banner.
  section = section.replace(/^\r?\n/, "");

  // Older mlx_lm echoes "Prompt: <original>" as the first line — drop it.
  const nl = section.indexOf("\n");
  const firstLine = nl === -1 ? section : section.slice(0, nl);
  if (firstLine.startsWith("Prompt: ")) {
    section = nl === -1 ? "" : section.slice(nl + 1);
  }

  // Once the closing banner has arrived, drop the single trailing newline that
  // mlx_lm emits before it (mid-stream we keep it — it may be real content).
  if (closed) section = section.replace(/\r?\n$/, "");

  return section.replace(SPECIAL_TOKEN, "");
}
