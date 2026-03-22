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

## Session: 2026-03-23

### Active issue

**[#20](https://github.com/falese/coder/issues/20) — docs: business requirements and product specification for commercial viability**

Produce business-consumable documentation that articulates what this project is, why it matters, and how it could be funded or grown. The intended readers are non-engineers: investors, engineering managers, platform leads.

Deliverables (from the issue):
1. **PRD** — problem statement, target personas, value props, P0/P1/P2 feature requirements, non-goals
2. **Market & Competitive Landscape** — alternatives, differentiation, addressable market
3. **Technical Architecture Summary** (executive-readable) — hardware cost model, adaptor marketplace, privacy guarantees, integration points
4. **Roadmap** — v1 through v4 milestones
5. **Commercial Model Options** — open core, marketplace rev share, enterprise license

### Context: what exists technically today

The complete end-to-end loop is working as of 2026-03-22:

- `coder generate` — local inference via MLX, buffered + streaming, adaptor selection, system prompt, context files
- `coder models` — HuggingFace download, list, info, remove
- `coder config` — TOML config with env overrides
- `coder adaptor` — install/update/remove (git-based), train (LoRA via mlx_lm), eval (TSC + ESLint + test suite scoring)
- `coder data` — ingest, extract (jsdoc/line_comment/ts_declare/constructor_call anchors), deduplicate, validate, split, stats
- **react-ts adaptor** — 144 MUI training records, eval composite 0.920, baseline 0.460, lift +0.460
- Eval harness — per-prompt TSC/ESLint/test-suite scoring, verbose report, adaptor-supplied declarations and eslint config, `--baseline` flag

### Open questions for this session

These should be answered in the PRD:

- **Primary monetisation path** — tooling SaaS, marketplace rev share, or enterprise license?
- **Adaptor marketplace model** — open community or enterprise-only?
- **IDE extension vs CLI-first** — which drives initial adoption?
- **Hosted registry timeline** — when does #16 become P0?

---

## Spec context

Not applicable — this is a documentation session, not a coding session. Do not write code.

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
./adaptors/react-ts/data/eval.jsonl
./adaptors/react-ts/data/train.jsonl
./adaptors/react-ts/data/valid.jsonl
./adaptors/react-ts/evals/declarations.d.ts
./adaptors/react-ts/evals/eslint.config.mjs
./adaptors/react-ts/evals/eval_suite.ts
./adaptors/react-ts/train-config.toml
./docs/eval-scoring.md
./docs/spec.md
./docs/session-prompt.md
```

---

## Existing tests (summary)

301 tests passing across 26 files. Do not duplicate:

- `runMlxBuffered`, `runMlxStream`, `checkPreflight` — mlx subprocess layer
- `loadConfig` / `setConfigValue` / `getConfigValue` — config reads/writes
- `Logger` — structured JSON log lines, log levels
- `checkMemory` — memory gate refuse/warn logic
- `AdaptorManager` — manifest validation (Zod), install, list, info, update, remove
- `ChatHistory` — conversation history, ChatML formatting, sliding window
- `data ingest/extract/deduplicate/validate/split/stats` — full data pipeline
- `runEval`, `computeComposite`, `formatEvalTable`, `formatEvalReport`, scorers — eval harness
- `loadTrainConfig`, `runMlxTrain` — training config + runner
- `coder generate`, `coder chat`, `coder config`, `coder models`, `coder adaptor`, `coder data` integration
- Extract anchors: `jsdoc`/`line_comment`/`ts_declare`/`constructor_call`
