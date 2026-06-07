/**
 * Concept-thread extraction (ported from the inner-voice MFE).
 *
 * The model ends a response with a tag:
 *   <threads>{"threads":["concept one","concept two"]}</threads>
 *
 * `parseThreads` pulls the string array out of that tag; `stripThreads` removes
 * the tag so the prose can stand alone. Both are total — they never throw and
 * degrade to an empty array / the original-minus-tag.
 */

const THREADS_TAG = /<threads>\s*([\s\S]*?)\s*<\/threads>/i;
const THREADS_TAG_GLOBAL = /<threads>[\s\S]*?<\/threads>/gi;

export function parseThreads(raw: string): string[] {
  const match = THREADS_TAG.exec(raw);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "threads" in parsed &&
      Array.isArray((parsed as { threads: unknown }).threads)
    ) {
      return (parsed as { threads: unknown[] }).threads
        .filter((t): t is string => typeof t === "string" && t.trim() !== "")
        .map((t) => t.trim());
    }
  } catch {
    // malformed JSON — fall through to empty array
  }
  return [];
}

/** Return the response text with any <threads>…</threads> block removed. */
export function stripThreads(raw: string): string {
  return raw.replace(THREADS_TAG_GLOBAL, "").trimEnd();
}
