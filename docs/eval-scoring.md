# Adaptor Eval Scoring

When you run `coder adaptor eval <name>`, the CLI scores the adaptor's output quality across three dimensions and produces a composite score. This document explains what those numbers mean and how to interpret them.

---

## The eval table

```
PROMPT                                    TSC   ESLINT  TESTS  COMPOSITE
-------------------------------------------------------------------------
/** Button component that wraps MUI Butt  0.0   0.0     1.0    0.300
declare module 'remote/Header'            1.0   0.0     1.0    0.700
/** Configure Module Federation for shel  1.0   0.0     1.0    0.700
// Themed text field with error state     0.0   0.0     1.0    0.300
/** List component using MUI List and Li  0.0   0.0     1.0    0.300
-------------------------------------------------------------------------
MEAN                                      0.4   0.0     1.0    0.460
```

Each row is one prompt from `data/eval.jsonl`. The model generates a completion for that prompt, and three automated checks are run against the output.

---

## The three dimensions

### TSC — TypeScript type correctness (weight: 40%)

Runs `tsc --noEmit` on the generated file. A score of `1.0` means the output compiled without type errors. A score of `0.0` means it did not.

This is the highest-weighted dimension because type errors are the most concrete signal that generated code is wrong. A component that compiles is a component you can use.

### ESLint — code style compliance (weight: 30%)

Runs ESLint against the generated file using the adaptor's ruleset (or the project default if none is provided). A score of `1.0` means zero lint errors. A score of `0.0` means at least one error was found.

Note: generated code often scores `0.0` on ESLint, especially if rules ban `any` types. This dimension is most useful for measuring improvement over time, not as an absolute quality gate.

### Tests — eval suite pass rate (weight: 30%)

Runs `bun test evals/eval_suite.ts` with the generated file injected via `CODER_EVAL_OUTPUT`. The eval suite is authored by the adaptor maintainer and can check for anything: structural patterns, exported symbols, MUI component usage, balanced JSX, etc.

A score of `1.0` means all assertions in the suite passed. A score of `0.0` means at least one failed.

---

## The composite score

```
composite = (TSC × 0.4) + (ESLint × 0.3) + (Tests × 0.3)
```

This collapses the three dimensions into a single number between `0.0` and `1.0`. A perfect score (`1.0`) means the output compiled, passed lint, and passed the eval suite.

Examples:

| TSC | ESLint | Tests | Composite | Interpretation                           |
| --- | ------ | ----- | --------- | ---------------------------------------- |
| 1.0 | 1.0    | 1.0   | 1.000     | Perfect output                           |
| 1.0 | 0.0    | 1.0   | 0.700     | Compiles and tests pass, has lint issues |
| 0.0 | 0.0    | 1.0   | 0.300     | Structurally correct, but type errors    |
| 0.0 | 0.0    | 0.0   | 0.000     | Output is not usable                     |

---

## Baseline vs eval pass rate

The manifest stores two scores:

```json
{
  "baseline_pass_rate": 0.14,
  "eval_pass_rate": 0.38
}
```

**`baseline_pass_rate`** — the score achieved by the _base model alone_ (no LoRA adaptor). Measured with `coder adaptor eval <name> --baseline`. This is your control group.

**`eval_pass_rate`** — the score achieved by the _base model + adaptor_. Measured with `coder adaptor eval <name>`.

### Why 0.380 is better than 0.140

The adaptor's job is to make the base model produce better domain-specific code than it would on its own. The **lift** is the difference:

```
lift = eval_pass_rate - baseline_pass_rate
     = 0.380 - 0.140
     = +0.240
```

A lift of `+0.240` means the adaptor raised output quality by 24 percentage points over the base model. The minimum acceptable lift for a react-ts adaptor is `+0.150`. This adaptor passes.

A negative lift would mean the adaptor is actively hurting the base model — a sign of bad training data or severe overfitting.

---

## Running the eval

```bash
# Measure baseline (base model, no adaptor)
coder adaptor eval react-ts --baseline

# Measure with adaptor
coder adaptor eval react-ts

# Override the eval input
coder adaptor eval react-ts --input path/to/custom.jsonl

# Use a specific model
coder adaptor eval react-ts --model ~/.coder/models/Qwen2.5-Coder-7B-Instruct-4bit

# Dry run (returns 0.5 for all dimensions, no inference)
CODER_DRY_RUN=1 coder adaptor eval react-ts
```

---

## Improving scores

| Symptom                         | Likely cause                                   | Fix                                                                |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| TSC = 0.0 across all prompts    | Generated code has type errors or is truncated | More training data; increase `--max-tokens`                        |
| ESLint = 0.0 across all prompts | Generated code uses `any` or violates rules    | Train on more explicitly typed examples                            |
| Tests = 0.0 across all prompts  | Output is garbage or empty                     | Check `parseMlxOutput` parsing; training data quality              |
| Lift is negative                | Adaptor hurts the base model                   | Training data contamination; overfitting; retrain with fewer iters |
| Lift < 0.15                     | Adaptor provides minimal benefit               | More diverse training data (target 500–1000 records)               |
