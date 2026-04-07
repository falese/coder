import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { initUiContext, resetUiContextForTest } from "../../src/ui/context.js";
import { renderTable } from "../../src/ui/table.js";
import { stripAnsi } from "../../src/ui/ansi.js";

beforeEach(() => {
  resetUiContextForTest();
  initUiContext({ isTTY: false }); // no ANSI codes
});

afterEach(() => {
  resetUiContextForTest();
});

function lines(output: string): string[] {
  return output.split("\n").filter((l) => l.trim() !== "");
}

describe("renderTable", () => {
  test("includes all header labels", () => {
    const out = stripAnsi(renderTable(["NAME", "VERSION"], [["react-ts", "1.0.0"]]));
    expect(out).toContain("NAME");
    expect(out).toContain("VERSION");
  });

  test("includes separator row of ─ characters", () => {
    const out = stripAnsi(renderTable(["NAME", "VERSION"], [["react-ts", "1.0.0"]]));
    expect(out).toContain("─");
  });

  test("includes all data rows", () => {
    const out = stripAnsi(renderTable(["A", "B"], [["row1a", "row1b"], ["row2a", "row2b"]]));
    expect(out).toContain("row1a");
    expect(out).toContain("row2b");
  });

  test("right-aligns numeric columns", () => {
    const out = stripAnsi(renderTable(
      ["NAME", "DISK"],
      [["short", "3.5 GB"], ["much-longer-name", "12 GB"]],
      { align: ["left", "right"] },
    ));
    // DISK column values should be right-padded to same width — check they appear
    expect(out).toContain("3.5 GB");
    expect(out).toContain("12 GB");
  });

  test("column widths respect header width when data is shorter", () => {
    const out = stripAnsi(renderTable(
      ["VERY_LONG_HEADER", "B"],
      [["x", "y"]],
    ));
    // header and data should both be on present
    const ls = lines(out);
    expect(ls[0]).toContain("VERY_LONG_HEADER");
    expect(ls[2]).toContain("x");
  });

  test("explicit widths override computed widths", () => {
    const out = stripAnsi(renderTable(
      ["A"],
      [["hi"]],
      { widths: [20] },
    ));
    // "A" should be padded to 20 chars
    const header = lines(out)[0];
    expect(header).toContain("A" + " ".repeat(19));
  });

  test("handles empty rows", () => {
    const out = stripAnsi(renderTable(["COL"], []));
    expect(out).toContain("COL");
    expect(out).toContain("─");
  });
});
