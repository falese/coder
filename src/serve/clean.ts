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

// Pipe placement varies by model/template — tolerate the common malformations
// (e.g. gemma emits "<channel|>" with no leading pipe). Order longest-first so a
// startsWith scan picks the most specific marker.
const CHANNEL_MARKERS = ["<|channel|>", "<|channel>", "<channel|>", "<channel>"];
const MESSAGE_MARKERS = ["<|message|>", "<|message>", "<message|>", "<message>"];
const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";
const GENERIC_TAG = /^<\|[^|>]*\|>/;

const KNOWN_CHANNELS: Record<string, "thought" | "final"> = {
  analysis: "thought",
  thinking: "thought",
  thought: "thought",
  reasoning: "thought",
  commentary: "thought",
  final: "final",
};

function matchAt(text: string, i: number, markers: string[]): string | null {
  for (const m of markers) {
    if (text.startsWith(m, i)) return m;
  }
  return null;
}

/**
 * Split generated text into reasoning ("thought") and answer ("final")
 * channels, consuming the structural markers and dropping other special tokens.
 *
 * Recognises:
 *   - DeepSeek style:   <think> … </think> answer
 *   - Harmony style:    <|channel|>analysis<|message|> … <|channel|>final<|message|> …
 *                       plus pipe-variant markers (<channel|>, <|channel>, …)
 *
 * A channel marker followed by a known name (analysis/commentary/… → thought,
 * final → final) switches voice. A marker with no recognised name (a garbled
 * switch right before the answer) defaults to "final", so an answer never hides
 * in the thought channel. Text with no markers is all "final" (instruct models).
 * Total — never throws.
 */
export function parseChannels(text: string): Channels {
  let thought = "";
  let final = "";
  let channel: "thought" | "final" = "final";
  let i = 0;
  const n = text.length;

  while (i < n) {
    if (text[i] === "<") {
      if (text.startsWith(THINK_OPEN, i)) {
        channel = "thought";
        i += THINK_OPEN.length;
        continue;
      }
      if (text.startsWith(THINK_CLOSE, i)) {
        channel = "final";
        i += THINK_CLOSE.length;
        continue;
      }

      const chan = matchAt(text, i, CHANNEL_MARKERS);
      if (chan) {
        i += chan.length;
        const word = /^[a-zA-Z]+/.exec(text.slice(i, i + 24))?.[0] ?? "";
        // Record index access is typed non-undefined without noUncheckedIndexedAccess;
        // annotate honestly so the truthiness checks below are real (unknown → undefined).
        const mapped: "thought" | "final" | undefined = KNOWN_CHANNELS[word.toLowerCase()];
        if (mapped) {
          channel = mapped;
          i += word.length;
        } else {
          // Unnamed / unrecognised switch → treat as the answer voice.
          channel = "final";
        }
        const msg = matchAt(text, i, MESSAGE_MARKERS);
        if (msg) i += msg.length;
        else if (mapped && (text[i] === " " || text[i] === "\n")) i += 1;
        continue;
      }

      const msgOnly = matchAt(text, i, MESSAGE_MARKERS);
      if (msgOnly) {
        i += msgOnly.length;
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
