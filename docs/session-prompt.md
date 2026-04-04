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

## Session: 2026-04-04

### Active issues

**[#29](https://github.com/falese/coder/issues/29) — feat: temperature/top-p passthrough in GenerateOptions**
**[#30](https://github.com/falese/coder/issues/30) — feat: sampleCompletions — scored multi-sample generator**

These two P0 issues land together in a single PR. They are the foundation for the SSD self-improvement loop — see `@docs/recursive-self-improvement-proposal.md` for full context.

Deliverables:
1. `temperature?: number` and `topP?: number` added to `GenerateOptions` in `src/inference/types.ts`
2. `--temp` / `--top-p` forwarded to `mlx_lm.generate` args in `src/inference/mlx-runner.ts` when set
3. New file `src/inference/sampler.ts` exporting `sampleCompletions` (see interface below)
4. Tests for all three above; no changes to existing callers

### Context: what exists technically today

- `GenerateOptions` in `src/inference/types.ts` — current interface has `model`, `adaptor`, `stream`, `systemPrompt`, `contextFiles`, `outputFile`; no temperature field yet
- `runMlxBuffered` / `runMlxStream` in `src/inference/mlx-runner.ts` — build a string args array and spawn `mlx_lm.generate`; arg-construction is already tested
- `runEval`, `computeComposite` in `src/eval/runner.ts` — scores a completion against TSC + ESLint + test suite; returns per-dimension scores and a 0–1 composite
- **react-ts adaptor** — 144 training records, eval composite 0.920; this is the first beneficiary once self-improve lands

### Open questions for this session

- Verify the exact `mlx_lm.generate` flag name for temperature before wiring: expected `--temp` (not `--temperature`) and `--top-p`. Confirm against `mlx_lm.generate --help` or existing subprocess tests before committing arg names.

---

## Spec context

### `GenerateOptions` — current shape (`src/inference/types.ts`)

```typescript
export interface GenerateOptions {
  model: string;
  prompt: string;
  maxTokens?: number;      // default 512
  dryRun?: boolean;
  adaptor?: string;
  stream?: boolean;
  outputFile?: string;
  contextFiles?: string[];
  systemFile?: string;     // path to system prompt file (not systemPrompt)
  rawPrompt?: boolean;     // pass --ignore-chat-template
  temperature?: number;    // forwarded as --temp; undefined → mlx_lm default (greedy / 0.0)
  topP?: number;           // forwarded as --top-p; undefined → mlx_lm default
}
```

### mlx-runner arg-construction pattern (`src/inference/mlx-runner.ts`)

New lines to add alongside existing optional-flag handling:
```typescript
if (opts.temperature !== undefined) args.push("--temp", String(opts.temperature));
if (opts.topP !== undefined)        args.push("--top-p", String(opts.topP));
```

### `sampleCompletions` — interface to implement (`src/inference/sampler.ts`)

```typescript
export interface SampleResult {
  prompt: string;
  completion: string;
  composite: number;
}

export async function sampleCompletions(
  prompts: string[],
  k: number,
  temperature: number,
  opts: Pick<GenerateOptions, "model" | "adaptor">,
  evalOpts: { adaptorDir: string },
): Promise<SampleResult[]>
```

- Generates exactly `prompts.length × k` completions (sequentially — no concurrency increase)
- Scores each via `runTscCheck` / `runEslintCheck` / `runTestsCheck` → `computeComposite`
- Returns all results (caller filters by threshold)
- Empty `prompts` array must return `[]` without error

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
./src/inference/sampler.ts          ← NEW (create this file)
./src/inference/types.ts
./src/models/inspector.ts
./src/models/pull.ts
./src/models/types.ts
./src/observability/logger.ts
./src/observability/types.ts
./src/training/config.ts
./src/training/runner.ts
./adaptors/react-ts/data/eval.jsonl
./adaptors/react-ts/data/train.jsonl
./adaptors/react-ts/data/valid.jsonl
./adaptors/react-ts/evals/declarations.d.ts
./adaptors/react-ts/evals/eslint.config.mjs
./adaptors/react-ts/evals/eval_suite.ts
./adaptors/react-ts/train-config.toml
./docs/eval-scoring.md
./docs/recursive-self-improvement-proposal.md
./docs/spec.md
./docs/session-prompt.md
```

---

## Existing tests (summary)

301 tests passing across 26 files. Do not duplicate:

- `runMlxBuffered`, `runMlxStream`, `checkPreflight` — mlx subprocess layer; **arg-construction is already tested** — add new tests for `--temp` / `--top-p` paths alongside existing ones
- `loadConfig` / `setConfigValue` / `getConfigValue` — config reads/writes
- `Logger` — structured JSON log lines, log levels
- `checkMemory` — memory gate refuse/warn logic
- `AdaptorManager` — manifest validation (Zod), install, list, info, update, remove
- `ChatHistory` — conversation history, ChatML formatting, sliding window
- `data ingest/extract/deduplicate/validate/split/stats` — full data pipeline
- `runEval`, `computeComposite`, `formatEvalTable`, `formatEvalReport`, scorers — eval harness; **`sampleCompletions` will call these — do not re-test them, just wire through**
- `loadTrainConfig`, `runMlxTrain` — training config + runner
- `coder generate`, `coder chat`, `coder config`, `coder models`, `coder adaptor`, `coder data` integration
- Extract anchors: `jsdoc`/`line_comment`/`ts_declare`/`constructor_call`

New tests to write this session:
- `GenerateOptions` with `temperature` / `topP` set → correct args appended to subprocess call
- `GenerateOptions` with neither set → no `--temp` / `--top-p` in args (no regression)
- `sampleCompletions` — correct total result count (`prompts.length × k`)
- `sampleCompletions` — composite score present on every result
- `sampleCompletions` — empty prompts array returns `[]`
