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

## Session: [DATE]

### Active issue

**[#9](https://github.com/falese/coder/issues/9) — Adaptor eval: quality scoring harness**

Build the full eval command in one session. All design decisions are resolved below — do not reopen.

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

### Commands

```
coder adaptor eval <name>                # score with adaptor
coder adaptor eval <name> --baseline     # score base model only — no adaptor
coder adaptor eval <name> --input <file> # score a specific file
```

`--baseline` is critical — it establishes `baseline_pass_rate` in `manifest.json` before training, so lift can be measured.

### Scoring dimensions

Embedding similarity is **dropped from v1**. Do not implement it.

| Dimension | Weight | Implementation |
|---|---|---|
| TypeScript type correctness | 0.35 | `tsc --noEmit --strict <file>` |
| ESLint compliance | 0.30 | `eslint --format json <file>` |
| Test pass rate | 0.35 | `bun test evals/eval_suite.ts` with `CODER_EVAL_OUTPUT` set |

Composite = `0.35×tsc + 0.30×eslint + 0.35×tests`

### Eval injection format

For each eval record, the CLI:
1. Generates output: `coder generate "<prompt>" [--adaptor <name>]`
2. Writes output to a temp `.ts` file in OS temp dir
3. Sets `CODER_EVAL_OUTPUT=<tempfile>`
4. Runs `bun test evals/eval_suite.ts`
5. Parses pass/fail count from bun output
6. Deletes temp file (always — use try/finally)

Adaptor authors write their eval suite like this:
```typescript
const generatedPath = process.env.CODER_EVAL_OUTPUT;
if (!generatedPath) throw new Error("CODER_EVAL_OUTPUT not set");
const { default: generated } = await import(generatedPath);
// assertions against `generated` follow
```

### Scorer implementations

**tsc scorer** (`src/eval/tsc.ts`):
- Spawn `tsc --noEmit --strict <tempfile>`
- Exit 0 = 1.0, non-zero = 0.0
- Aggregate: mean across all eval records

**ESLint scorer** (`src/eval/eslint.ts`):
- Spawn `eslint --format json <tempfile>`
- Use adaptor's `evals/.eslintrc.json` if present, else project default
- Score per record = `1 - (errorCount / (errorCount + warningCount + 1))`
- Aggregate: mean across all eval records

**Test pass rate scorer** (`src/eval/tests.ts`):
- Set `CODER_EVAL_OUTPUT`, spawn `bun test evals/eval_suite.ts`
- Parse bun test output: `N pass` / `M fail`
- Score per record = `passCount / (passCount + failCount)`
- Aggregate: mean across all eval records

**Composite** (`src/eval/composite.ts`):
- `0.35×tsc + 0.30×eslint + 0.35×tests`

### manifest.json schema update

Add `baseline_pass_rate` to the Zod schema in `src/adaptors/types.ts`:

```typescript
baseline_pass_rate: z.number().min(0).max(1).default(0),
eval_pass_rate: z.number().min(0).max(1).default(0),
```

`--baseline` writes `baseline_pass_rate`. Normal eval writes `eval_pass_rate`.

### Output format

```
Eval: react-ts (with adaptor)
────────────────────────────────────────────
Record   tsc    eslint  tests  composite
1        1.00   0.85    0.80   0.88
2        0.00   0.70    0.60   0.43
────────────────────────────────────────────
Mean     0.72   0.81    0.74   0.76
────────────────────────────────────────────
eval_pass_rate: 0.76 written to manifest.json
```

### Architecture

- `src/eval/tsc.ts` — tsc scorer
- `src/eval/eslint.ts` — eslint scorer
- `src/eval/tests.ts` — bun test scorer
- `src/eval/composite.ts` — aggregation + composite calculation
- `src/commands/adaptor.ts` — add `eval` subcommand (already has list/install/info/update/remove)
- No `console.log` — use `logger` from `src/observability/logger.ts`
- `CODER_DRY_RUN=1` — skip generation and subprocess spawns, return mock scores of 0.5 for all dimensions

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
./src/inference/memory-gate.ts
./src/inference/mlx-runner.ts
./src/inference/types.ts
./src/models/inspector.ts
./src/models/pull.ts
./src/models/types.ts
./src/observability/logger.ts
./src/observability/types.ts
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
./tests/unit/logger.test.ts
./tests/unit/memory-gate.test.ts
./tests/unit/mlx-runner.test.ts
./tests/unit/models-inspector.test.ts
./tests/unit/pull.test.ts
```

---

## Existing tests (summary)

213 tests passing across 23 files. Do not duplicate:

- `runMlxBuffered`, `runMlxStream`, `checkPreflight` — mlx subprocess layer
- `loadConfig` / `setConfigValue` / `getConfigValue` — config reads/writes
- `Logger` — structured JSON log lines, log levels
- `checkMemory` — memory gate refuse/warn logic
- `AdaptorManager` — manifest validation (Zod), install, list, info, update, remove
- `ChatHistory` — conversation history, ChatML formatting, sliding window
- `data ingest/extract/deduplicate/validate/split/stats` — full data pipeline
- `coder generate`, `coder chat`, `coder config`, `coder models`, `coder adaptor`, `coder data` integration

---

## Open questions for this session

All resolved — do not reopen.

- **Embedding similarity:** dropped from v1. Composite = tsc + eslint + tests only. Weights: 0.35 / 0.30 / 0.35.
- **`--baseline` flag:** same eval, no `--adaptor` passed to generation. Writes `baseline_pass_rate` not `eval_pass_rate`.
- **Eval injection:** `CODER_EVAL_OUTPUT` env var pointing to temp file. Always cleaned up in try/finally.
- **ESLint config:** use adaptor's `evals/.eslintrc.json` if present, else project default.
- **Dry-run:** skip all subprocess spawns, return 0.5 for all dimensions.
- **manifest.json:** `baseline_pass_rate` added to Zod schema alongside existing `eval_pass_rate`.
