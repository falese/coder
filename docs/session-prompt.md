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

## Session: 2026-03-22

### Active issue

**[#11](https://github.com/falese/coder/issues/11) — react-ts adaptor pack: first domain adaptor**

Build the react-ts adaptor pack end-to-end:
1. Extend `coder data extract` with missing anchors (`ts_declare`, `constructor_call`) needed for MFE/MUI patterns
2. Curate training data from MUI and Module Federation source repos
3. Run training with `coder adaptor train`
4. Write eval suite (`evals/eval_suite.ts`)
5. Establish baseline (`coder adaptor eval react-ts --baseline`) then measure lift

### TDD instructions

Work strictly test-first:

1. Write one failing test that captures the next behaviour
2. Write the minimum code to make it pass
3. Refactor if needed
4. Repeat

Do not write implementation code without a failing test first.
Do not move to the next behaviour until the current test passes.

---

## Spec context

### Adaptor pack structure

```
~/.coder/adaptors/react-ts/
├── weights/
│   └── adaptor.safetensors
├── data/
│   ├── train.jsonl
│   └── valid.jsonl           ← mlx_lm lora requires valid.jsonl (NOT eval.jsonl)
├── evals/
│   ├── eval_suite.ts
│   └── .eslintrc.json        ← optional; falls back to project default
├── prompts/
│   └── system.md
├── extract.json
└── manifest.json
```

### manifest.json schema (current Zod shape in src/adaptors/types.ts)

```json
{
  "name": "react-ts",
  "version": "1.0.0",
  "domain": "frontend",
  "base_model": "Qwen2.5-Coder-7B",
  "mlx_quant": "4bit",
  "lora_rank": 8,
  "min_memory_gb": 18,
  "eval_pass_rate": 0.0,
  "baseline_pass_rate": 0.0,
  "author": "",
  "description": "React TypeScript + MUI + Module Federation patterns"
}
```

### extract.json anchors — what is and isn't implemented

**Already implemented** in `src/data/extract.ts`:
- `jsdoc` → `next_function`
- `line_comment` → `next_function`, `next_block`

**NOT YET implemented** (needed for MFE/MUI patterns):
- `ts_declare` → `declare_body`   (for MFE remote type contracts)
- `jsdoc` → `constructor_call`   (for `new ModuleFederationPlugin({...})` patterns)

These two anchors must be added to `src/data/extract.ts` with tests in `tests/unit/data-extract.test.ts` **before** running data extraction.

### `ts_declare` anchor

Matches TypeScript `declare module '...' {` or `declare module "..." {` header lines, capturing the header as prompt and the body (everything inside the braces) as completion.

```typescript
// prompt anchor: declare module 'remote/Button' {
// completion anchor: everything inside the module block
declare module 'remote/Button' {
  export const Button: React.FC<ButtonProps>;
}
```

### `constructor_call` anchor

Matches `new ClassName({...})` expressions following a jsdoc comment. Used for Module Federation plugin config blocks.

```typescript
/** Exposes Button component */
new ModuleFederationPlugin({
  name: "shell",
  remotes: { ui: "ui@http://localhost:3001/remoteEntry.js" },
  shared: { react: { singleton: true } },
});
```

### Data sources for react-ts adaptor

- **MUI**: `https://github.com/mui/material-ui` — components in `packages/mui-material/src/`; focus on `.tsx` files with JSDoc comments
- **Module Federation**: `https://github.com/module-federation/core` — examples in `packages/*/src/`; focus on webpack plugin configs and remote type declarations

Extraction rules for `extract.json`:
```json
{
  "rules": [
    { "prompt": "jsdoc", "completion": "next_function" },
    { "prompt": "jsdoc", "completion": "constructor_call" },
    { "prompt": "ts_declare", "completion": "declare_body" },
    { "prompt": "line_comment", "completion": "next_function" }
  ]
}
```

### Training command

```bash
coder adaptor train --config ~/.coder/adaptors/react-ts/train-config.toml
```

`train-config.toml` contents:
```toml
adaptor_name = "react-ts"
base_model = "~/.coder/models/Qwen2.5-Coder-7B-Instruct-4bit"
data_dir = "~/.coder/adaptors/react-ts/data"
output_dir = "~/.coder/adaptors/react-ts/weights"
lora_rank = 8
lora_target_modules = ["q_proj", "v_proj"]
epochs = 5
batch_size = 4
learning_rate = 1e-4
grad_checkpoint = true
```

`grad_checkpoint = true` is required to fit within 18GB on M3.

### Eval scoring (already wired in coder adaptor eval)

Composite = 0.4×tsc + 0.3×eslint + 0.3×tests

Baseline: `coder adaptor eval react-ts --baseline` → writes `baseline_pass_rate`
With adaptor: `coder adaptor eval react-ts` → writes `eval_pass_rate`
Lift target: `eval_pass_rate - baseline_pass_rate >= 0.15`

### Dry-run for eval development

`CODER_DRY_RUN=1 coder adaptor eval react-ts` returns all scores = 0.5

---

## Current file tree

```
./src/adaptors/manager.ts
./src/adaptors/types.ts
./src/chat/history.ts
./src/cli/index.ts
./src/commands/adaptor.ts
./src/commands/chat.ts
./src/commands/config.ts
./src/commands/data.ts
./src/commands/generate.ts
./src/commands/logs.ts
./src/commands/models.ts
./src/config/loader.ts
./src/config/types.ts
./src/data/deduplicate.ts
./src/data/extract.ts
./src/data/ingest.ts
./src/data/split.ts
./src/data/stats.ts
./src/data/types.ts
./src/data/validate.ts
./src/eval/runner.ts
./src/inference/memory-gate.ts
./src/inference/mlx-runner.ts
./src/inference/types.ts
./src/models/inspector.ts
./src/models/pull.ts
./src/models/types.ts
./src/observability/logger.ts
./src/observability/types.ts
./src/training/config.ts
./src/training/runner.ts
./tests/integration/adaptors.test.ts
./tests/integration/chat.test.ts
./tests/integration/config.test.ts
./tests/integration/data.test.ts
./tests/integration/generate-streaming.test.ts
./tests/integration/generate.test.ts
./tests/integration/logs.test.ts
./tests/integration/models.test.ts
./tests/unit/adaptors-manager.test.ts
./tests/unit/chat-history.test.ts
./tests/unit/config-loader.test.ts
./tests/unit/data-deduplicate.test.ts
./tests/unit/data-extract.test.ts
./tests/unit/data-ingest.test.ts
./tests/unit/data-split.test.ts
./tests/unit/data-stats.test.ts
./tests/unit/data-types.test.ts
./tests/unit/data-validate.test.ts
./tests/unit/eval-runner.test.ts
./tests/unit/logger.test.ts
./tests/unit/memory-gate.test.ts
./tests/unit/mlx-runner.test.ts
./tests/unit/models-inspector.test.ts
./tests/unit/pull.test.ts
./tests/unit/training-config.test.ts
./tests/unit/training-runner.test.ts
```

---

## Existing tests (summary)

271 tests passing across 26 files. Do not duplicate:

- `runMlxBuffered`, `runMlxStream`, `checkPreflight` — mlx subprocess layer
- `loadConfig` / `setConfigValue` / `getConfigValue` — config reads/writes
- `Logger` — structured JSON log lines, log levels
- `checkMemory` — memory gate refuse/warn logic
- `AdaptorManager` — manifest validation (Zod), install, list, info, update, remove
- `ChatHistory` — conversation history, ChatML formatting, sliding window
- `data ingest/extract/deduplicate/validate/split/stats` — full data pipeline
- `runEval`, `computeComposite`, `formatEvalTable`, scorers — eval harness unit tests
- `loadTrainConfig`, `runMlxTrain` — training config + runner
- `coder generate`, `coder chat`, `coder config`, `coder models`, `coder adaptor`, `coder data` integration
- Existing extract anchors: `jsdoc` → `next_function`, `line_comment` → `next_function`/`next_block`

---

## Open questions for this session

All resolved — do not reopen.

- **New anchors needed:** `ts_declare` → `declare_body` and `jsdoc`/`line_comment` → `constructor_call` must be added before extraction can run on MFE source.
- **Data sources:** MUI (`packages/mui-material/src/`) + Module Federation (`packages/*/src/`) — both MIT licensed.
- **Combined adaptor:** single `react-ts` pack combining MUI + MFE patterns (confirmed).
- **Lift threshold:** `eval_pass_rate - baseline_pass_rate >= 0.15` to consider adaptor successful.
- **valid.jsonl:** `coder data split` outputs `*.valid.jsonl`, which is what `mlx_lm lora --data` requires.
- **Memory during training:** `grad_checkpoint = true` in train config to stay within 18GB on M3.
