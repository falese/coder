const SEP = "==========";

/**
 * Strip the `mlx_lm.generate` framing from cumulative raw stdout: the
 * "==========" banners, the older "Prompt: <echo>" line, the trailing
 * stats block, and the single trailing newline before the closing banner.
 * Special/chat tokens are NOT removed here — channel parsing needs them.
 * Text with no banner (e.g. dry-run output) is returned unchanged. Total.
 */
export function stripFraming(raw: string): string {
  const first = raw.indexOf(SEP);
  if (first === -1) return raw;

  let section = raw.slice(first + SEP.length);
  const close = section.indexOf(SEP);
  const closed = close !== -1;
  if (closed) section = section.slice(0, close);

  section = section.replace(/^\r?\n/, "");

  const nl = section.indexOf("\n");
  const firstLine = nl === -1 ? section : section.slice(0, nl);
  if (firstLine.startsWith("Prompt: ")) {
    section = nl === -1 ? "" : section.slice(nl + 1);
  }

  if (closed) section = section.replace(/\r?\n$/, "");
  return section;
}

export interface Channels {
  /** Reasoning / chain-of-thought (the model's "inner voice"). */
  thought: string;
  /** The crystallized answer. */
  final: string;
}

const GENERIC_TAG = /^<\|[^|>]*\|>/;
const CHANNEL_OPEN = /^<\|channel\|?>/;
const CHANNEL_NAME = /^[a-zA-Z_]+/;

/**
 * Split generated text into reasoning ("thought") and answer ("final")
 * channels, consuming the structural markers and dropping other special tokens.
 *
 * Recognises:
 *   - DeepSeek style:   <think> … </think> answer
 *   - Harmony style:    <|channel|>analysis<|message|> … <|channel|>final<|message|> …
 *                       (and the single-pipe <|channel>name … variant)
 * Channel "final" → final; any other name (analysis/commentary/thought) →
 * thought. Text with no markers is all "final" (instruct models). Total — never
 * throws.
 */
export function parseChannels(text: string): Channels {
  let thought = "";
  let final = "";
  let channel: "thought" | "final" = "final";
  let i = 0;
  const n = text.length;

  while (i < n) {
    if (text[i] === "<") {
      if (text.startsWith("<think>", i)) {
        channel = "thought";
        i += "<think>".length;
        continue;
      }
      if (text.startsWith("</think>", i)) {
        channel = "final";
        i += "</think>".length;
        continue;
      }

      const open = CHANNEL_OPEN.exec(text.slice(i, i + 11));
      if (open) {
        i += open[0].length;
        const nameMatch = CHANNEL_NAME.exec(text.slice(i, i + 32));
        const name = nameMatch ? nameMatch[0] : "thought";
        channel = name.toLowerCase() === "final" ? "final" : "thought";
        i += name.length;
        if (text.startsWith("<|message|>", i)) i += "<|message|>".length;
        else if (text[i] === " " || text[i] === "\n") i += 1;
        continue;
      }
      if (text.startsWith("<|message|>", i)) {
        i += "<|message|>".length;
        continue;
      }

      const generic = GENERIC_TAG.exec(text.slice(i, i + 24));
      if (generic) {
        if (generic[0] === "<|end|>" || generic[0] === "<|return|>") channel = "final";
        i += generic[0].length;
        continue;
      }
    }

    if (channel === "thought") thought += text[i];
    else final += text[i];
    i += 1;
  }

  return { thought, final };
}
