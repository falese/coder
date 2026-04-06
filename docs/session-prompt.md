# Coder — Session Prompt

> Update this file before each coding session. Hand it to the agent alongside CLAUDE.md.
> Keep CLAUDE.md open in every session. Reference @docs/spec.md only for the sections relevant to the active issue.

---

## How to use this template

1. Fill in **Active issue** and **Scope** below
2. Copy the relevant spec sections from `@docs/spec.md` into **Spec context**
3. Update **Current file tree** to reflect actual state
4. Hand `CLAUDE.md` + this file to the coding agent
5. After the session, update **Current state** in `CLAUDE.md` and any resolved decisions in `docs/spec.md`

---

## Session: 2026-04-05

### Active issue

**[#40](https://github.com/falese/coder/issues/40) — feat: prompt capture and SSD sampling pool decoupling**

Decouple the SSD loop's sampling pool from `eval.jsonl`. When `capture_prompts = true` in config,
`coder generate --adaptor <name>` appends the user's prompt to `adaptors/<name>/data/prompt-log.jsonl`.
`runSelfImprove` uses `prompt-log.jsonl` as the SSD sampling pool when present, falling back to eval
prompts when absent. `eval.jsonl` becomes a clean holdout that is never touched by the SSD loop.

---

## Spec context

### Architecture

Two independent concerns landing together:

**A. Prompt capture** — `coder generate` side

- New config key `capture_prompts = false` (boolean, opt-in)
- When enabled and `--adaptor` is specified, append to `adaptors/<name>/data/prompt-log.jsonl` after `generation_complete`
- Schema: `{"prompt": "...", "ts": "2026-04-05T...", "adaptor_version": "2.0.5"}`
- `adaptor_version` read from `adaptors/<name>/manifest.json` at capture time (missing manifest → omit field, don't error)
- Never capture when `CODER_DRY_RUN=1`

**B. SSD sampling pool** — `runSelfImprove` side

- Check for `data/prompt-log.jsonl` before falling back to eval prompts:

```typescript
const samplePromptFile = join(opts.adaptorDir, "data", "prompt-log.jsonl");
const rawPrompts = existsSync(samplePromptFile)
  ? loadJsonlPairs(samplePromptFile).map((r) => r.prompt)
  : evalPairs.map((r) => r.prompt);
```

- Apply filters before sampling (token estimate = `chars / 4`, same heuristic used elsewhere):
  - Drop prompts below 20 tokens (too vague)
  - Drop prompts above 1500 tokens (pasted component context)
  - Deduplicate using existing `deduplicate()` from `src/data/deduplicate.ts`
- If filters reduce pool to zero, fall back to eval prompts (log a WARN)
- `eval.jsonl` is never modified anywhere in this flow

### Config system changes

`CoderConfig` currently only holds string values. `capture_prompts` is boolean — needs careful handling:

**`src/config/types.ts`:**

```typescript
export interface CoderConfig {
  // ... existing fields ...
  capture_prompts: boolean;
}

export const CONFIG_KEYS = [
  "default_model",
  "adaptors_dir",
  "models_dir",
  "logs_dir",
  "log_level",
  "capture_prompts",
] as const;
```

**`src/config/loader.ts`** — add boolean branch in `mergeRawIntoConfig`:

```typescript
if (key === "capture_prompts") {
  if (typeof value === "boolean") config.capture_prompts = value;
} else if (key === "log_level") {
  // ... existing handling ...
} else if (typeof value === "string") {
  config[key] = value;
}
```

Default: `capture_prompts: false` in `DEFAULT_CONFIG`.

**`coder config set capture_prompts true`** — `setConfigValue` writes strings, but smol-toml
will write `"true"` as a string. On load, `mergeRawIntoConfig` must also handle the string form:

```typescript
if (key === "capture_prompts") {
  if (typeof value === "boolean") config.capture_prompts = value;
  else if (value === "true") config.capture_prompts = true;
  else if (value === "false") config.capture_prompts = false;
}
```

### Prompt-log.jsonl location

`adaptors/<name>/data/prompt-log.jsonl` — lives in the adaptor pack alongside `train.jsonl`
and `eval.jsonl`. The `data/` directory already exists for all adaptors.

`adaptors/<name>/data/` is not committed to git (`.gitignore` in each adaptor pack root
should already exclude `data/` or at minimum `data/prompt-log.jsonl`).

Check the existing `.gitignore` in `adaptors/react-ts/` — if `data/` is not excluded,
add `data/prompt-log.jsonl` to the adaptor `.gitignore` files as part of this PR.

---

## Files to change

| File                              | Change                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/config/types.ts`             | Add `capture_prompts: boolean` to `CoderConfig` and `CONFIG_KEYS`                           |
| `src/config/loader.ts`            | Add `capture_prompts: false` to `DEFAULT_CONFIG`; boolean branch in `mergeRawIntoConfig`    |
| `src/commands/generate.ts`        | Append to `prompt-log.jsonl` post-generation when capture enabled and `--adaptor` used      |
| `src/adaptors/self-improve.ts`    | Use `prompt-log.jsonl` as sampling pool when present; apply token filters + dedup           |
| `tests/unit/generate.test.ts`     | Capture writes when opt-in + adaptor; no write when opt-out; no write in dry-run            |
| `tests/unit/self-improve.test.ts` | SSD uses prompt-log when present; falls back to eval prompts when absent; filter edge cases |
| `adaptors/react-ts/.gitignore`    | Add `data/prompt-log.jsonl` if not already excluded                                         |
| `adaptors/react-ts-v2/.gitignore` | Same                                                                                        |

---

## TDD order

Write failing tests first, then implementation.

**generate.ts capture tests:**

1. `capture_prompts=true` + `--adaptor foo` → `prompt-log.jsonl` created with correct entry
2. `capture_prompts=true` + no `--adaptor` → no write (no adaptor, no domain signal)
3. `capture_prompts=false` + `--adaptor foo` → no write (opt-out respected)
4. `capture_prompts=true` + `CODER_DRY_RUN=1` → no write

**self-improve.ts sampling pool tests:** 5. `prompt-log.jsonl` absent → sampling uses eval prompts (current behaviour preserved) 6. `prompt-log.jsonl` present → sampling uses prompt-log prompts, not eval prompts 7. Prompts below 20 tokens filtered out 8. Prompts above 1500 tokens filtered out 9. Duplicate prompts deduplicated before sampling 10. All prompts filtered → falls back to eval prompts + WARN logged

---

## Existing tests (summary)

~325 tests passing. Do not duplicate existing coverage.

Key existing tests to be aware of:

- `tests/unit/self-improve.test.ts` — existing SSD tests use eval prompts; test 5 above must verify this still works
- `tests/unit/config.test.ts` — existing config load/set tests; new `capture_prompts` key must not break them
