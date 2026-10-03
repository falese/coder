/**
 * drift-audit adaptor — coder-side SMOKE eval (spec §6a).
 *
 * Runs via:  bun test adaptors/drift-audit/evals/eval_suite.ts
 *
 * This proves the NARROW WAIST holds — that a drift-audit response is a typed
 * artifact a deterministic floor can consume. For every fixture it asserts the
 * output:
 *   - parses as a JSON array;
 *   - every element matches the `hardened` or `semantic` shape;
 *   - every `hardened.pattern` compiles via `new RegExp(pattern)`;
 *   - every `enforces` is an ADR id that appeared in that fixture's bundle
 *     (no invented decisions);
 *   - an empty array appears ONLY where the bundle carries no auditable
 *     decision (`allowEmpty`) — never as a "looks clean" certification.
 *
 * It does NOT prove the findings are correct. That is the platform-side,
 * git-mined recall/precision eval (spec §6b, ADR-090), which runs against git
 * history with Sentinel's HardenedCheckSchema + verify — not in coder.
 *
 * Output source:
 *   - default: each fixture's recorded `completion.json` (the representative
 *     model output committed with the fixture). This keeps the smoke green
 *     with no served model, and pins the exact contract the pack promises.
 *   - CODER_DRIFT_LIVE=1: shell out to `coder generate` with this pack and the
 *     fixture bundle, and validate the LIVE model output instead. This is how
 *     the smoke runs in a coder-enabled env (spec §8). `coder` must be on PATH
 *     and a default_model configured.
 *
 * The pack is git-distributable, so this file imports NO coder internals; live
 * mode goes through the `coder` CLI exactly as the platform seam does (§7).
 */
import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

const EVALS_DIR = import.meta.dir;
const PACK_DIR = dirname(EVALS_DIR);
const FIXTURES_DIR = join(PACK_DIR, "fixtures");
const SYSTEM_PROMPT = join(PACK_DIR, "prompts", "system.md");
const LIVE = process.env.CODER_DRIFT_LIVE === "1";

// ---------------------------------------------------------------------------
// Finding shapes — the coder-side view of the narrow waist.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function isRecord(x: unknown): x is Json {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isHardened(x: unknown): x is Json {
  if (!isRecord(x) || x.kind !== "hardened") return false;
  return (
    typeof x.id === "string" &&
    x.id.length > 0 &&
    typeof x.enforces === "string" &&
    typeof x.message === "string" &&
    typeof x.fix === "string" &&
    typeof x.pattern === "string" &&
    typeof x.confidence === "number" &&
    (x.exempt === undefined || typeof x.exempt === "string")
  );
}

function isSemantic(x: unknown): x is Json {
  if (!isRecord(x) || x.kind !== "semantic") return false;
  return (
    typeof x.enforces === "string" &&
    typeof x.message === "string" &&
    typeof x.where === "string" &&
    typeof x.evidence === "string" &&
    typeof x.confidence === "number"
  );
}

function variantOf(x: unknown): "hardened" | "semantic" | null {
  if (isHardened(x)) return "hardened";
  if (isSemantic(x)) return "semantic";
  return null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Expect {
  directive?: string;
  requireVariants?: ("hardened" | "semantic")[];
  patternMustMatch?: string;
  nonEmpty?: boolean;
  maxConfidence?: number;
  allowEmpty?: boolean;
}

interface Fixture {
  name: string;
  dir: string;
  bundleFiles: string[];
  adrIds: Set<string>;
  expect: Expect;
}

function listBundleFiles(bundleDir: string): string[] {
  if (!existsSync(bundleDir)) return [];
  return readdirSync(bundleDir)
    .map((f) => join(bundleDir, f))
    .filter((p) => statSync(p).isFile());
}

function extractAdrIds(text: string): string[] {
  return [...text.matchAll(/\bADR-\d+\b/g)].map((m) => m[0]);
}

function loadFixtures(): Fixture[] {
  if (!existsSync(FIXTURES_DIR)) return [];
  const fixtures: Fixture[] = [];
  for (const entry of readdirSync(FIXTURES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(FIXTURES_DIR, entry.name);
    const bundleFiles = listBundleFiles(join(dir, "bundle"));
    const adrIds = new Set<string>();
    for (const f of bundleFiles) {
      for (const id of extractAdrIds(readFileSync(f, "utf-8"))) adrIds.add(id);
    }
    const expectPath = join(dir, "expect.json");
    const expect: Expect = existsSync(expectPath)
      ? (JSON.parse(readFileSync(expectPath, "utf-8")) as Expect)
      : {};
    fixtures.push({ name: entry.name, dir, bundleFiles, adrIds, expect });
  }
  return fixtures;
}

// ---------------------------------------------------------------------------
// Output source — recorded completion, or a live `coder generate` run.
// ---------------------------------------------------------------------------

async function runLive(fx: Fixture): Promise<string> {
  const directive =
    fx.expect.directive ?? `Audit the provided bundle (${fx.name}) for drift.`;
  const args = [
    "generate",
    directive,
    "--adaptor",
    "drift-audit",
    "--system",
    SYSTEM_PROMPT,
  ];
  for (const f of fx.bundleFiles) args.push("--context", f);

  const proc = Bun.spawn(["coder", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`coder generate failed for ${fx.name}: ${stderr.trim()}`);
  }
  return stdout;
}

async function getOutput(fx: Fixture): Promise<string> {
  if (LIVE) return runLive(fx);
  const recorded = join(fx.dir, "completion.json");
  if (!existsSync(recorded)) {
    throw new Error(
      `fixture ${fx.name} has no completion.json (recorded mode). ` +
        `Either add one or run with CODER_DRIFT_LIVE=1.`,
    );
  }
  return readFileSync(recorded, "utf-8");
}

function parseFindings(raw: string, fxName: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch (e) {
    throw new Error(
      `${fxName}: output is not valid JSON (bare JSON array required, no prose ` +
        `or fences). Cause: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${fxName}: output parsed but is not a JSON array`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Suite — one describe block per fixture (spec §6a).
// ---------------------------------------------------------------------------

const fixtures = loadFixtures();

describe(`drift-audit smoke eval (${LIVE ? "LIVE" : "recorded"})`, () => {
  test("fixtures are present", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fx of fixtures) {
    describe(fx.name, () => {
      test("output is a JSON array of well-typed findings", async () => {
        const findings = parseFindings(await getOutput(fx), fx.name);

        for (const [i, el] of findings.entries()) {
          const variant = variantOf(el);
          if (variant === null) {
            throw new Error(
              `${fx.name}[${String(i)}] matches neither the hardened nor the ` +
                `semantic shape: ${JSON.stringify(el)}`,
            );
          }
        }

        // Empty output is legal ONLY where the bundle has no auditable decision.
        if (findings.length === 0 && fx.expect.allowEmpty !== true) {
          throw new Error(
            `${fx.name}: empty array, but this bundle has an auditable ` +
              `decision — "no drift" must be ranked low-confidence suspects, ` +
              `never an empty "clean".`,
          );
        }
      });

      test("every hardened.pattern compiles as a RegExp", async () => {
        const findings = parseFindings(await getOutput(fx), fx.name);
        for (const el of findings) {
          if (isHardened(el)) {
            expect(() => new RegExp(el.pattern as string)).not.toThrow();
          }
        }
      });

      test("every `enforces` is an ADR id from the bundle (none invented)", async () => {
        const findings = parseFindings(await getOutput(fx), fx.name);
        for (const el of findings) {
          const enforces = (el as Json).enforces;
          expect(typeof enforces).toBe("string");
          expect([...fx.adrIds]).toContain(enforces as string);
        }
      });

      // Per-fixture expectations from expect.json.
      test("meets its per-fixture expectation", async () => {
        const findings = parseFindings(await getOutput(fx), fx.name);
        const ex = fx.expect;

        if (ex.nonEmpty === true) {
          expect(findings.length).toBeGreaterThan(0);
        }

        if (ex.requireVariants) {
          const seen = new Set(findings.map(variantOf));
          for (const v of ex.requireVariants) expect(seen).toContain(v);
        }

        if (ex.patternMustMatch !== undefined) {
          const probe = ex.patternMustMatch;
          const matched = findings.some(
            (el) =>
              isHardened(el) && new RegExp(el.pattern as string).test(probe),
          );
          expect(matched).toBe(true);
        }

        if (ex.maxConfidence !== undefined) {
          for (const el of findings) {
            expect((el as Json).confidence as number).toBeLessThanOrEqual(
              ex.maxConfidence,
            );
          }
        }
      });
    });
  }
});
