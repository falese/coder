import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  threadRecall,
  scoreThreadRecall,
  runPersonaEval,
  toEvalSummary,
} from "../../../src/eval/persona.js";

describe("threadRecall", () => {
  test("perfect overlap → 1/1/1", () => {
    expect(threadRecall(["a", "b"], ["a", "b"])).toEqual({ precision: 1, recall: 1, f1: 1 });
  });

  test("partial overlap computes precision/recall/f1", () => {
    // predicted {a,b,c}, reference {a,b} → inter 2; precision 2/3, recall 2/2=1
    const r = threadRecall(["a", "b", "c"], ["a", "b"]);
    expect(r.precision).toBeCloseTo(2 / 3, 5);
    expect(r.recall).toBe(1);
    expect(r.f1).toBeCloseTo((2 * (2 / 3) * 1) / (2 / 3 + 1), 5);
  });

  test("normalizes case/whitespace", () => {
    expect(threadRecall([" A "], ["a"]).f1).toBe(1);
  });

  test("no overlap → 0/0/0", () => {
    expect(threadRecall(["x"], ["y"])).toEqual({ precision: 0, recall: 0, f1: 0 });
  });

  test("empty predicted → recall 0", () => {
    expect(threadRecall([], ["a"])).toEqual({ precision: 0, recall: 0, f1: 0 });
  });
});

describe("scoreThreadRecall", () => {
  test("scores a completion's <threads> against the prompt's references", () => {
    const refs = new Map<string, string[]>([["p1", ["debounce", "timers"]]]);
    const scorer = scoreThreadRecall(refs);
    const completion = 'answer <threads>{"threads":["debounce","timers"]}</threads>';
    expect(scorer("p1", completion)).toBe(1);
  });

  test("unknown prompt → 0", () => {
    const scorer = scoreThreadRecall(new Map());
    expect(scorer("nope", "<threads>{\"threads\":[\"a\"]}</threads>")).toBe(0);
  });
});

describe("runPersonaEval (dry-run)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "coder-persona-"));
    mkdirSync(join(dir, "data"), { recursive: true });
    writeFileSync(
      join(dir, "data", "persona-eval.jsonl"),
      [
        JSON.stringify({ prompt: "p1", threads: ["a", "b"] }),
        JSON.stringify({ prompt: "p2", threads: ["c"] }),
      ].join("\n") + "\n",
    );
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("returns a deterministic stub summary without a model", async () => {
    const summary = await runPersonaEval(dir, { modelPath: "/m", dryRun: true });
    expect(summary.records).toHaveLength(2);
    expect(summary.meanF1).toBe(0.5);
  });

  test("toEvalSummary maps F1 into the EvalSummary composite slot", async () => {
    const summary = await runPersonaEval(dir, { modelPath: "/m", dryRun: true });
    const evalSummary = toEvalSummary(summary);
    expect(evalSummary.meanComposite).toBe(0.5);
    expect(evalSummary.records[0].composite).toBe(0.5);
    expect(evalSummary.records[0].prompt).toBe("p1");
  });
});
