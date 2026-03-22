import type { ExtractRule, JsonlRecord } from "./types.js";

interface AnchorMatch {
  type: "jsdoc" | "line_comment" | "ts_declare";
  text: string;
  start: number;
  end: number;
}

interface Span {
  text: string;
  end: number;
}

function findAllAnchors(src: string): AnchorMatch[] {
  const anchors: AnchorMatch[] = [];

  // jsdoc blocks: /** ... */
  const jsdocRe = /\/\*\*[\s\S]*?\*\//g;
  let m: RegExpExecArray | null;
  while ((m = jsdocRe.exec(src)) !== null) {
    anchors.push({
      type: "jsdoc",
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  // line comment blocks: one or more consecutive // lines
  const lcRe = /^[ \t]*\/\/[^\n]*(?:\n[ \t]*\/\/[^\n]*)*/gm;
  while ((m = lcRe.exec(src)) !== null) {
    anchors.push({
      type: "line_comment",
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  // ts_declare: declare module '...' { or declare module "..." {
  const declareRe = /^[ \t]*declare\s+module\s+['"][^'"]+['"]/gm;
  while ((m = declareRe.exec(src)) !== null) {
    anchors.push({
      type: "ts_declare",
      text: m[0].trim(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  anchors.sort((a, b) => a.start - b.start);
  return anchors;
}

function findMatchingBrace(src: string, openPos: number): number {
  let depth = 0;
  for (let i = openPos; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findNextFunction(src: string, fromPos: number): Span | null {
  // Match common function declaration patterns
  const re =
    /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s+\w+|(?:export\s+)?(?:const|let)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>/g;
  re.lastIndex = fromPos;
  const m = re.exec(src);
  if (!m) return null;

  const bracePos = src.indexOf("{", m.index + m[0].length - 1);
  if (bracePos === -1 || bracePos - m.index > 500) return null;

  const closePos = findMatchingBrace(src, bracePos);
  if (closePos === -1) return null;

  return { text: src.slice(m.index, closePos + 1), end: closePos + 1 };
}

function findNextBlock(src: string, fromPos: number): Span | null {
  const bracePos = src.indexOf("{", fromPos);
  if (bracePos === -1) return null;

  const closePos = findMatchingBrace(src, bracePos);
  if (closePos === -1) return null;

  return { text: src.slice(bracePos, closePos + 1), end: closePos + 1 };
}

function findDeclareBody(src: string, fromPos: number): Span | null {
  const bracePos = src.indexOf("{", fromPos);
  if (bracePos === -1 || bracePos - fromPos > 100) return null;

  const closePos = findMatchingBrace(src, bracePos);
  if (closePos === -1) return null;

  return { text: src.slice(bracePos, closePos + 1), end: closePos + 1 };
}

function findNextConstructorCall(src: string, fromPos: number): Span | null {
  const re = /\bnew\s+\w[\w.]*\s*\(/g;
  re.lastIndex = fromPos;
  const m = re.exec(src);
  if (!m) return null;

  // Walk from opening paren matching depth
  const openParen = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) {
        const end = src[i + 1] === ";" ? i + 2 : i + 1;
        return { text: src.slice(m.index, end), end };
      }
    }
  }
  return null;
}

export function extractFromSource(
  src: string,
  rules: ExtractRule[],
): JsonlRecord[] {
  const anchors = findAllAnchors(src);
  const records: JsonlRecord[] = [];
  let minPos = 0;

  for (const anchor of anchors) {
    if (anchor.start < minPos) continue;

    for (const rule of rules) {
      if (rule.prompt !== anchor.type) continue;

      const completion =
        rule.completion === "next_function"
          ? findNextFunction(src, anchor.end)
          : rule.completion === "declare_body"
            ? findDeclareBody(src, anchor.end)
            : rule.completion === "constructor_call"
              ? findNextConstructorCall(src, anchor.end)
              : findNextBlock(src, anchor.end);

      if (completion) {
        records.push({ prompt: anchor.text, completion: completion.text });
        minPos = completion.end;
        break;
      }
    }
  }

  return records;
}
