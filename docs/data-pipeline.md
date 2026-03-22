# Data Pipeline Guide

> How to prepare training datasets for LoRA adaptor fine-tuning.

---

## Overview

The `coder data` commands form a curation pipeline that turns raw source code into clean JSONL training data for `mlx_lm.lora`. Each command is a standalone filter — pipe them together or run them individually.

```
source files
    │
    ▼
coder data ingest        → raw.jsonl       (one record per file)
    │
    ▼
coder data extract       → extracted.jsonl  (prompt/completion pairs)
    │
    ▼
coder data deduplicate   → deduped.jsonl    (near-duplicates removed)
    │
    ▼
coder data validate      → validation report (gates quality)
    │
    ▼
coder data split         → train.jsonl + eval.jsonl
    │
    ▼
coder data stats         → quality metrics
```

---

## Quick start

```bash
# Ingest a TypeScript repo
coder data ingest "src/**/*.ts" --output raw.jsonl

# Extract prompt/completion pairs using adaptor rules
coder data extract --adaptor react-ts --input raw.jsonl --output extracted.jsonl

# Remove near-duplicates
coder data deduplicate extracted.jsonl --output deduped.jsonl

# Validate quality gates
coder data validate deduped.jsonl

# Split into train/eval sets (90/10 default)
coder data split deduped.jsonl --output-dir ~/.coder/adaptors/react-ts/data/

# Review stats before training
coder data stats deduped.jsonl
```

---

## Setting up a source repository for best results

### 1. Use consistent comment conventions

`coder data extract` relies on comment anchors to identify prompt/completion pairs. The more consistently your repo uses these patterns, the richer the extracted dataset.

**JSDoc → function body** (`jsdoc` → `next_function` rule):

```typescript
/** Returns the debounced version of fn with the given delay */
export function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout>;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
```

**Line comment → block** (`line_comment` → `next_block` rule):

```typescript
// Validate that the user object has all required fields before saving
if (!user.email || !user.name || !user.role) {
  throw new ValidationError("Missing required user fields");
}
```

**TypeScript remote type contract → declare body** (`ts_declare` → `declare_body` rule):

```typescript
declare module 'remote/Button' {
  export const Button: React.FC<ButtonProps>;
  export const IconButton: React.FC<IconButtonProps>;
}
```

**JSDoc → constructor call** (`jsdoc` → `constructor_call` rule, useful for webpack plugin configs):

```typescript
/** Configure Module Federation shell */
new ModuleFederationPlugin({
  name: 'shell',
  remotes: { ui: `ui@${process.env.UI_URL}/remoteEntry.js` },
  shared: { react: { singleton: true, requiredVersion: '^18.0.0' } },
});
```

**Tips:**
- Every exported function should have a JSDoc comment describing what it does (not how)
- Use line comments before complex conditional blocks to explain intent
- Avoid comments that just repeat the code — "increment i" above `i++` produces useless training pairs
- Aim for 1–3 sentences per JSDoc comment; longer is better for prompt quality

### 2. Recommended file types

Include:
- `.ts`, `.tsx` — TypeScript source
- `.js` — JavaScript source
- `.graphql`, `.gql` — GraphQL schemas/operations (for GraphQL adaptor)

Exclude (add to your ingest glob to skip):
- `*.d.ts` — type declaration files (no implementations)
- `node_modules/` — third-party code not representative of your patterns
- `dist/`, `build/`, `.next/` — compiled output
- `*.test.ts`, `*.spec.ts` — test files produce noisy training pairs (unless deliberately training on test patterns)
- Generated files (GraphQL codegen output, proto stubs, etc.)

Example glob that excludes noise:
```bash
coder data ingest "src/**/*.ts" --output raw.jsonl
# The ingest command automatically skips files >100KB and binary files
```

### 3. Authoring `extract.json`

Each adaptor pack requires an `extract.json` at its root. This file defines the extraction rules applied to your source files.

```json
{
  "rules": [
    { "prompt": "jsdoc", "completion": "next_function" },
    { "prompt": "line_comment", "completion": "next_block" }
  ]
}
```

**Prompt anchor types:**
- `jsdoc`: matches `/** ... */` blocks only (not `/* */` or `//`)
- `line_comment`: matches one or more consecutive `// ...` lines
- `ts_declare`: matches `declare module '...'` header lines — for TypeScript remote type contracts (MFE pattern)

**Completion anchor types:**
- `next_function`: captures the next `function`, `const x = () =>`, or `async function` with its full body
- `next_block`: captures the next `{ ... }` block (useful for conditionals, loops, object literals)
- `declare_body`: captures the `{ ... }` body of a `declare module` block (use with `ts_declare` prompt)
- `constructor_call`: captures the next `new ClassName({...})` expression (use for webpack plugin configs)

**General rules:**
- Rules are applied in order — the first rule that produces a match wins for a given anchor
- Anchors with no matching completion are silently skipped

**Ordering advice:**
- Put the most-specific rule first — `jsdoc → next_function` before `line_comment → next_block`
- If your codebase uses mostly JSDoc, a single `jsdoc → next_function` rule may suffice
- Missing `extract.json` is a hard error — every adaptor pack must include one

### 4. Quality targets before training

Check these metrics with `coder data stats` before starting a training run:

| Metric | Target |
|--------|--------|
| Record count | ≥ 500 training pairs |
| Prompt token mean | < 200 tokens |
| Completion token mean | < 400 tokens |
| Duplicate rate | < 5% |

If duplicate rate is high (> 5%) after extraction, your source files may lack variety — pull in more repos or broaden the glob.

If token means are too high, your completions are capturing too much context. Consider using `next_block` instead of `next_function` for shorter completions, or adjust your comment placement so anchors land closer to the relevant code.

---

## Command reference

### `coder data ingest <glob>`

Walk files matching the glob pattern and emit one JSONL record per file.

```bash
coder data ingest "src/**/*.ts"                     # stdout
coder data ingest "src/**/*.ts" --output raw.jsonl  # file
```

- Skips files larger than 100 KB
- Skips binary files (null bytes detected in first 512 bytes)
- Record format: `{ "prompt": "<relative path>", "completion": "<file contents>" }`
- The glob is resolved relative to the current working directory

### `coder data extract --adaptor <name>`

Apply the adaptor's `extract.json` rules to produce prompt/completion pairs.

```bash
coder data extract --adaptor react-ts --input raw.jsonl --output extracted.jsonl
```

- Reads `~/.coder/adaptors/<name>/extract.json` — error if missing
- `--input`: JSONL file; uses the `completion` field of each record as source
- Without `--input`: reads raw source text from stdin (one JSONL record per line)
- Rules applied in order; first match per anchor wins

### `coder data deduplicate <file>`

Remove exact and near-duplicate records.

```bash
coder data deduplicate extracted.jsonl --output deduped.jsonl
```

- Pass 1: exact deduplication on `prompt + completion`
- Pass 2: Jaccard similarity on character trigrams with threshold 0.85 — the later-occurring near-duplicate is dropped
- Prints removed count to stderr

### `coder data validate <file>`

Check each record against quality gates.

```bash
coder data validate deduped.jsonl
```

Gates per record:
- `prompt` must be non-empty
- `completion` must be non-empty
- Each field must be ≤ 2048 tokens (estimated as `ceil(chars / 4)`)

Exits 0 if all records pass, 1 if any fail. Prints invalid line numbers.

### `coder data split <file>`

Deterministically shuffle and split into train/eval sets.

```bash
coder data split deduped.jsonl --output-dir ~/.coder/adaptors/react-ts/data/
coder data split deduped.jsonl --train-ratio 0.8 --seed 42
```

- Default ratio: 90% train / 10% eval
- Default seed: 42 (Fisher-Yates shuffle — reproducible)
- Output: `train.jsonl` and `valid.jsonl` in `--output-dir` (`mlx_lm.lora` requires `valid.jsonl`)
- `--output-dir`: directory for output files (defaults to same directory as input)

### `coder data stats <file>`

Print dataset statistics.

```bash
coder data stats deduped.jsonl
```

Output:
```
Records:     523
Prompt tokens    mean=45.2  p50=38  p95=142
Completion tokens  mean=87.6  p50=71  p95=312
Duplicate rate:  1.1%
```

---

## Full example: preparing the react-ts adaptor dataset

This example curates training data from the MUI and Module Federation open-source repos and trains the `react-ts` adaptor.

```bash
# 0. Prerequisites
coder models pull mlx-community/Qwen2.5-Coder-7B-Instruct-4bit
coder adaptor install react-ts --from-git file://$(pwd)/adaptors/react-ts

# 1. Clone source repos (~600 MB combined, MIT licensed)
git clone --depth=1 https://github.com/mui/material-ui /tmp/mui
git clone --depth=1 https://github.com/module-federation/core /tmp/mfe

# 2. Ingest source files
coder data ingest "/tmp/mui/packages/mui-material/src/**/*.tsx" --output /tmp/mui-raw.jsonl
coder data ingest "/tmp/mfe/packages/*/src/**/*.ts" --output /tmp/mfe-raw.jsonl

# 3. Extract prompt/completion pairs using the adaptor's extract.json rules
coder data extract --adaptor react-ts --input /tmp/mui-raw.jsonl --output /tmp/mui-extracted.jsonl
coder data extract --adaptor react-ts --input /tmp/mfe-raw.jsonl --output /tmp/mfe-extracted.jsonl

# 4. Combine sources
cat /tmp/mui-extracted.jsonl /tmp/mfe-extracted.jsonl > /tmp/combined.jsonl

# 5. Remove near-duplicates
coder data deduplicate /tmp/combined.jsonl --output /tmp/deduped.jsonl

# 6. Validate quality gates
coder data validate /tmp/deduped.jsonl

# 7. Split into train/valid (mlx_lm.lora requires valid.jsonl)
coder data split /tmp/deduped.jsonl \
  --output-dir ~/.coder/adaptors/react-ts/data/

# 8. Review stats before training
coder data stats /tmp/deduped.jsonl

# 9. Establish baseline (base model, no adaptor)
coder adaptor eval react-ts --baseline

# 10. Train (~30–60 min on M3, grad_checkpoint keeps memory under 18 GB)
coder adaptor train --config ~/.coder/adaptors/react-ts/train-config.toml

# 11. Evaluate with adaptor — target lift ≥ 0.15
coder adaptor eval react-ts
```
