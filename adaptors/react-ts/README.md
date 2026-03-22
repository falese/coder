# react-ts adaptor pack

LoRA adaptor for React TypeScript + MUI + Module Federation patterns, fine-tuned on top of Qwen2.5-Coder-7B-Instruct-4bit.

## Install

```bash
coder adaptor install react-ts --from-git https://github.com/falese/coder-adaptor-react-ts
```

Or from a local clone:

```bash
coder adaptor install react-ts --from-git file:///path/to/coder/adaptors/react-ts
```

## Use

```bash
coder generate "write a MUI Button component with loading state" --adaptor react-ts
coder chat --adaptor react-ts
```

## Data curation workflow

Run these steps once to build the training dataset. Requires ~8 GB disk space for source repos.

```bash
# 1. Download base model (~4 GB)
coder models pull mlx-community/Qwen2.5-Coder-7B-Instruct-4bit

# 2. Clone source repos
git clone --depth=1 https://github.com/mui/material-ui /tmp/mui
git clone --depth=1 https://github.com/module-federation/core /tmp/mfe

# 3. Ingest source files
coder data ingest "/tmp/mui/packages/mui-material/src/**/*.tsx" --output /tmp/mui-raw.jsonl
coder data ingest "/tmp/mfe/packages/*/src/**/*.ts" --output /tmp/mfe-raw.jsonl

# 4. Extract prompt/completion pairs using this adaptor's extract.json rules
coder data extract --adaptor react-ts --input /tmp/mui-raw.jsonl --output /tmp/mui-extracted.jsonl
coder data extract --adaptor react-ts --input /tmp/mfe-raw.jsonl --output /tmp/mfe-extracted.jsonl

# 5. Combine, deduplicate, validate, split
cat /tmp/mui-extracted.jsonl /tmp/mfe-extracted.jsonl > /tmp/combined.jsonl
coder data deduplicate /tmp/combined.jsonl --output /tmp/deduped.jsonl
coder data validate /tmp/deduped.jsonl
coder data split /tmp/deduped.jsonl --output-dir ~/.coder/adaptors/react-ts/data/
# Produces: train.jsonl (~90%) and valid.jsonl (~10%)

# 6. Verify stats
coder data stats ~/.coder/adaptors/react-ts/data/train.jsonl
```

## Training workflow

```bash
# Establish baseline (base model without adaptor)
coder adaptor eval react-ts --baseline

# Train (600 iters, ~30-60 min on M3, grad_checkpoint keeps memory under 18 GB)
coder adaptor train --config ~/.coder/adaptors/react-ts/train-config.toml

# Evaluate with adaptor
coder adaptor eval react-ts

# Target: eval_pass_rate - baseline_pass_rate >= 0.15
```

## Eval scoring

Composite score = 0.4 × tsc + 0.3 × eslint + 0.3 × tests

- **tsc**: `tsc --noEmit --strict` on each generated file
- **eslint**: uses `evals/.eslintrc.json` (React + TypeScript rules)
- **tests**: `bun test evals/eval_suite.ts` with `CODER_EVAL_OUTPUT` pointing to generated file
