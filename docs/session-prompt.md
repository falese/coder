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

**[#7](https://github.com/falese/coder/issues/7) — Data: JSONL dataset curation pipeline**

Build the full pipeline in one session. All design decisions are resolved below — do not reopen.

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
coder data ingest <glob>               # walk directory, output raw file contents as JSONL
coder data extract --adaptor <name>    # extract prompt/completion pairs using adaptor's extract.json
coder data deduplicate <file.jsonl>    # remove exact + near-duplicate records
coder data validate <file.jsonl>       # check schema, filter malformed, report stats
coder data split <file.jsonl>          # split into train.jsonl + eval.jsonl
coder data stats <file.jsonl>          # report token counts, length distribution, duplicate rate
```

All commands accept `--output <file>` to write results; default is stdout.

### JSONL record format

```json
{"prompt": "Create a debounced function", "completion": "export function debounce(...) { ... }"}
```

### `data ingest`

- Walks a directory tree matching a glob (e.g. `src/**/*.ts`)
- Outputs one JSONL record per file: `{"prompt": "<filename>", "completion": "<file contents>"}`
- Skips binary files and files over 100KB

### `data extract`

- `--adaptor <name>` is **required** — exits with error if omitted
- Reads `~/.coder/adaptors/<name>/extract.json` — exits with error if file not found
- Applies rules from `extract.json` to each source file, outputs matching prompt/completion pairs

#### `extract.json` format (Zod-validated)

```json
{
  "rules": [
    { "prompt": "jsdoc", "completion": "next_function" },
    { "prompt": "line_comment", "completion": "next_block" }
  ]
}
```

#### Supported anchors

| Anchor | Matches |
|---|---|
| `jsdoc` | `/** ... */` block immediately preceding a declaration |
| `line_comment` | One or more `//` lines immediately preceding a block |
| `next_function` | The `function`/`const`/`arrow` declaration + body that follows the prompt |
| `next_block` | The next `{...}` block that follows the prompt |

Rules are applied in order. A file section that matches multiple rules uses the first match. Sections with no match are skipped silently.

### `data deduplicate`

- Removes exact duplicates (identical `prompt` + `completion` string)
- Near-duplicate removal: Jaccard similarity on character trigrams, threshold configurable (default 0.85)
- Reports removed count to stderr

### `data validate`

- Checks: non-empty `prompt`, non-empty `completion`, valid UTF-8, estimated token count ≤ 2048 (chars ÷ 4)
- Filters out invalid records, writes valid records to output
- Reports pass/fail counts and reasons to stderr

### `data split`

- Splits into `train.jsonl` (90%) and `eval.jsonl` (10%) by default
- Deterministic: shuffle uses a configurable seed (default `42`)
- `--train-ratio <0-1>` flag to override the 90/10 default
- Writes two files: `<basename>.train.jsonl` and `<basename>.eval.jsonl` alongside the input file (or to `--output` dir)

### `data stats`

- Reports: record count, mean/p50/p95 prompt token length, mean/p50/p95 completion token length, exact duplicate rate
- Output is human-readable text to stdout (not JSONL)

### Architecture constraints

- All pipeline stages are pure functions over JSONL — easy to test with fixture files
- `data extract` reads adaptor path from `config.adaptors_dir` — no hardcoded paths
- No `console.log` — use `logger` from `src/observability/logger.ts` for warnings
- Each command lives in `src/commands/data.ts`, logic in `src/data/` modules

---

## Current file tree

```
./CLAUDE.md
./README.md
./STATUS.md
./bun.lock
./bunfig.toml
./docs/session-prompt.md
./docs/spec.md
./eslint.config.mjs
./package.json
./src/adaptors/manager.ts
./src/adaptors/types.ts
./src/chat/history.ts
./src/cli/index.ts
./src/commands/adaptor.ts
./src/commands/chat.ts
./src/commands/config.ts
./src/commands/generate.ts
./src/commands/logs.ts
./src/commands/models.ts
./src/config/loader.ts
./src/config/types.ts
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
./tests/integration/generate-streaming.test.ts
./tests/integration/generate.test.ts
./tests/integration/logs.test.ts
./tests/integration/models.test.ts
./tests/unit/adaptors-manager.test.ts
./tests/unit/chat-history.test.ts
./tests/unit/config-loader.test.ts
./tests/unit/logger.test.ts
./tests/unit/memory-gate.test.ts
./tests/unit/mlx-runner.test.ts
./tests/unit/models-inspector.test.ts
./tests/unit/pull.test.ts
./tsconfig.json
```

---

## Existing tests (summary)

143 tests passing across 15 files. Do not duplicate:

- `parseMlxOutput`, `runMlxBuffered`, `runMlxStream`, `checkPreflight` — mlx subprocess layer
- `loadConfig` / `setConfigValue` / `getConfigValue` — config reads/writes, env overrides
- `Logger` — structured JSON log lines, log levels, file output
- `checkMemory` — memory gate refuse/warn logic
- `streamFileToPath` — streaming file download with progress
- `ModelInspector` — memory estimates, config parsing, model listing
- `AdaptorManager` — manifest validation, install, list, info, update, remove
- `ChatHistory` — conversation history, ChatML formatting, sliding window truncation
- `coder generate` integration — buffered and streaming with `CODER_DRY_RUN=1`
- `coder chat` integration
- `coder config`, `coder models`, `coder adaptor`, `coder logs` integration

---

## Open questions for this session

All resolved — do not reopen.

- **`data extract` pattern format:** Structured rules with named anchors (`jsdoc`, `line_comment`, `next_function`, `next_block`) in `extract.json`
- **`extract.json` location:** Adaptor pack root (`~/.coder/adaptors/<name>/extract.json`), separate from `manifest.json`
- **Fallback when no adaptor/extract.json:** `--adaptor` flag is required; missing `extract.json` is a hard error
- **Deduplication algorithm:** Jaccard similarity on character trigrams, threshold 0.85, configurable
- **Token estimation:** character count ÷ 4 (same heuristic used in `ChatHistory`)
- **Split ratio:** 90/10 default, `--train-ratio` flag to override, seed 42 default
