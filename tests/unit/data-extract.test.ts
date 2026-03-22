import { describe, test, expect } from "bun:test";
import { extractFromSource } from "../../src/data/extract.js";
import type { ExtractRule } from "../../src/data/types.js";

describe("extractFromSource", () => {
  const jsdocToFunction: ExtractRule = {
    prompt: "jsdoc",
    completion: "next_function",
  };
  const lineCommentToBlock: ExtractRule = {
    prompt: "line_comment",
    completion: "next_block",
  };

  test("extracts jsdoc → next_function pair", () => {
    const src = `
/** Adds two numbers */
function add(a: number, b: number) {
  return a + b;
}
`;
    const records = extractFromSource(src, [jsdocToFunction]);
    expect(records).toHaveLength(1);
    expect(records[0].prompt).toContain("Adds two numbers");
    expect(records[0].completion).toContain("function add");
    expect(records[0].completion).toContain("return a + b");
  });

  test("extracts line_comment → next_block pair", () => {
    const src = `
// validate input
if (!input) {
  throw new Error("no input");
}
`;
    const records = extractFromSource(src, [lineCommentToBlock]);
    expect(records).toHaveLength(1);
    expect(records[0].prompt).toContain("validate input");
    expect(records[0].completion).toContain("throw new Error");
  });

  test("extracts multiple consecutive pairs", () => {
    const src = `
/** First function */
function first() {
  return 1;
}

/** Second function */
function second() {
  return 2;
}
`;
    const records = extractFromSource(src, [jsdocToFunction]);
    expect(records).toHaveLength(2);
    expect(records[0].completion).toContain("first");
    expect(records[1].completion).toContain("second");
  });

  test("first matching rule wins for overlapping anchor types", () => {
    // source has only a jsdoc comment — only jsdocToFunction rule should match
    const src = `
/** My function */
function myFn() {
  return true;
}
`;
    const records = extractFromSource(src, [jsdocToFunction, lineCommentToBlock]);
    expect(records).toHaveLength(1);
    expect(records[0].prompt).toContain("My function");
  });

  test("skips anchor when no completion follows", () => {
    // jsdoc at end of file with no function after it
    const src = `
function existing() {}

/** Orphan jsdoc at end */
`;
    const records = extractFromSource(src, [jsdocToFunction]);
    expect(records).toHaveLength(0);
  });

  test("returns empty array when no anchors present", () => {
    const src = `const x = 1;\nconst y = 2;\n`;
    const records = extractFromSource(src, [jsdocToFunction]);
    expect(records).toHaveLength(0);
  });

  test("extracts const arrow function with jsdoc", () => {
    const src = `
/** Doubles a value */
const double = (n: number) => {
  return n * 2;
};
`;
    const records = extractFromSource(src, [jsdocToFunction]);
    expect(records).toHaveLength(1);
    expect(records[0].completion).toContain("double");
    expect(records[0].completion).toContain("n * 2");
  });

  test("extracts multi-line line_comment block as single prompt", () => {
    const src = `
// Check if the user is authenticated
// and has the required role
if (user.role === "admin") {
  allow();
}
`;
    const records = extractFromSource(src, [lineCommentToBlock]);
    expect(records).toHaveLength(1);
    expect(records[0].prompt).toContain("authenticated");
    expect(records[0].prompt).toContain("required role");
  });

  test("does not double-extract when completion contains nested anchor type", () => {
    const src = `
/** Outer function */
function outer() {
  /** inner jsdoc that should not be a new anchor */
  return inner();
}
`;
    const records = extractFromSource(src, [jsdocToFunction]);
    // The nested jsdoc is inside the first completion — should not produce a second record
    expect(records).toHaveLength(1);
  });
});
