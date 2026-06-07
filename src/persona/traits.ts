/**
 * Prompt-layer persona traits — the v1 "TARS dial".
 *
 * Traits are a small vector of named dials on a 1–7 scale. They are applied at
 * request time by appending deterministic directives to the system prompt — no
 * retraining, immediate effect. This is the resolved v1 control layer (the
 * adapter-layer alternative is deferred; mlx_lm cannot blend adapters live and
 * coder runs one adaptor per session).
 *
 * Every function here is total: parsing never throws and unknown/mistyped input
 * degrades to null or to the neutral default.
 */

export const TRAIT_NAMES = ["formality", "sarcasm", "verbosity"] as const;
export type TraitName = (typeof TRAIT_NAMES)[number];

export type TraitVector = Record<TraitName, number>;

export const TRAIT_MIN = 1;
export const TRAIT_MAX = 7;

/** Neutral midpoint for every trait. */
export const DEFAULT_TRAITS: TraitVector = {
  formality: 4,
  sarcasm: 1,
  verbosity: 4,
};

function isTraitName(s: string): s is TraitName {
  return (TRAIT_NAMES as readonly string[]).includes(s);
}

/** Clamp to an integer in [TRAIT_MIN, TRAIT_MAX]. */
export function clampLevel(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TRAITS.formality;
  return Math.max(TRAIT_MIN, Math.min(TRAIT_MAX, Math.round(n)));
}

type Band = "low" | "mid" | "high";

function bandOf(level: number): Band {
  if (level <= 2) return "low";
  if (level >= 6) return "high";
  return "mid";
}

// Per-trait directive phrasing, banded by level. Deterministic by construction.
const DIRECTIVES: Record<TraitName, Record<Band, string>> = {
  formality: {
    low: "Keep the tone casual and conversational.",
    mid: "Use a balanced, professional-but-approachable tone.",
    high: "Maintain a formal, precise, and measured tone.",
  },
  sarcasm: {
    low: "Avoid sarcasm; stay sincere and straightforward.",
    mid: "Allow occasional mild, dry wit.",
    high: "Be liberally sarcastic and quippy, without being mean.",
  },
  verbosity: {
    low: "Be terse; prefer short, direct answers.",
    mid: "Give a balanced level of detail.",
    high: "Be thorough and expansive; explain your reasoning.",
  },
};

/**
 * Parse a control-plane intent string into a single trait/level update.
 * Recognises: "set sarcasm to 3", "sarcasm 3", "set sarcasm 3", "sarcasm=3".
 * Returns null when the input is not a recognised trait command.
 */
export function parseTraitCommand(input: string): { trait: TraitName; level: number } | null {
  const m = /^\s*(?:set\s+)?([a-z]+)\s*(?:to|=|\s)\s*(-?\d+)\s*$/i.exec(input);
  if (!m) return null;
  const trait = m[1].toLowerCase();
  if (!isTraitName(trait)) return null;
  return { trait, level: clampLevel(parseInt(m[2], 10)) };
}

/**
 * Merge a partial trait source (request body, persisted state) over the
 * defaults, clamping every value. Unknown keys and mistyped values are ignored.
 */
export function resolveTraits(source?: Partial<Record<string, unknown>> | null): TraitVector {
  const out: TraitVector = { ...DEFAULT_TRAITS };
  if (!source) return out;
  for (const name of TRAIT_NAMES) {
    const v = source[name];
    if (typeof v === "number" && Number.isFinite(v)) out[name] = clampLevel(v);
  }
  return out;
}

/**
 * Append persona directives to a base system prompt. Stable ordering (TRAIT_NAMES)
 * makes the output deterministic for a given trait vector.
 */
export function applyTraits(baseSystemPrompt: string, traits: TraitVector): string {
  const lines = TRAIT_NAMES.map((name) => {
    const level = clampLevel(traits[name]);
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    return `- ${label} (${String(level)}/${String(TRAIT_MAX)}): ${DIRECTIVES[name][bandOf(level)]}`;
  });
  const block = `Persona directives (dialable traits):\n${lines.join("\n")}`;
  return baseSystemPrompt.trim().length > 0
    ? `${baseSystemPrompt}\n\n${block}`
    : block;
}
