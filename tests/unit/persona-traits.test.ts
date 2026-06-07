import { describe, test, expect } from "bun:test";
import {
  TRAIT_NAMES,
  DEFAULT_TRAITS,
  parseTraitCommand,
  applyTraits,
  resolveTraits,
} from "../../src/persona/traits.js";

describe("parseTraitCommand", () => {
  test("parses 'set <trait> to <n>'", () => {
    expect(parseTraitCommand("set sarcasm to 3")).toEqual({ trait: "sarcasm", level: 3 });
  });

  test("parses bare '<trait> <n>'", () => {
    expect(parseTraitCommand("formality 5")).toEqual({ trait: "formality", level: 5 });
  });

  test("parses '<trait>=<n>' and is case-insensitive", () => {
    expect(parseTraitCommand("Verbosity=7")).toEqual({ trait: "verbosity", level: 7 });
  });

  test("clamps out-of-range levels into 1..7", () => {
    expect(parseTraitCommand("sarcasm 99")).toEqual({ trait: "sarcasm", level: 7 });
    expect(parseTraitCommand("sarcasm 0")).toEqual({ trait: "sarcasm", level: 1 });
  });

  test("returns null for unknown traits", () => {
    expect(parseTraitCommand("set grumpiness to 4")).toBeNull();
  });

  test("returns null for non-commands", () => {
    expect(parseTraitCommand("what is the meaning of life")).toBeNull();
    expect(parseTraitCommand("")).toBeNull();
  });
});

describe("resolveTraits", () => {
  test("returns defaults when source is empty/absent", () => {
    expect(resolveTraits()).toEqual(DEFAULT_TRAITS);
    expect(resolveTraits({})).toEqual(DEFAULT_TRAITS);
  });

  test("merges and clamps a partial source over defaults", () => {
    const t = resolveTraits({ sarcasm: 9, formality: 0 });
    expect(t.sarcasm).toBe(7);
    expect(t.formality).toBe(1);
    expect(t.verbosity).toBe(DEFAULT_TRAITS.verbosity);
  });

  test("ignores unknown keys and mistyped values", () => {
    const t = resolveTraits({ sarcasm: "loud", bogus: 3 } as unknown as Record<string, unknown>);
    expect(t).toEqual(DEFAULT_TRAITS);
  });
});

describe("applyTraits", () => {
  test("preserves the base system prompt", () => {
    const out = applyTraits("You are a helpful assistant.", DEFAULT_TRAITS);
    expect(out).toContain("You are a helpful assistant.");
  });

  test("emits a directive line per trait", () => {
    const out = applyTraits("base", DEFAULT_TRAITS);
    for (const name of TRAIT_NAMES) {
      expect(out.toLowerCase()).toContain(name);
    }
  });

  test("high sarcasm reads differently from low sarcasm", () => {
    const high = applyTraits("base", resolveTraits({ sarcasm: 7 }));
    const low = applyTraits("base", resolveTraits({ sarcasm: 1 }));
    expect(high).not.toBe(low);
    expect(high.toLowerCase()).toContain("sarcas");
  });

  test("is deterministic for the same inputs", () => {
    const a = applyTraits("base", resolveTraits({ sarcasm: 3, formality: 5 }));
    const b = applyTraits("base", resolveTraits({ sarcasm: 3, formality: 5 }));
    expect(a).toBe(b);
  });
});
