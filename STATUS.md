# Coder — Project Status

> Last updated: 2026-03-22

---

## Progress against base prompt

The base prompt defines seven objectives. Status tracked below.

| # | Objective | Status | Notes |
|---|---|---|---|
| 1 | CLI framework | ✅ Done | `generate` (buffered + streaming), `chat`, `config`, `models`, `adaptor`, `logs` all working |
| 2 | Model management | ✅ Done | `models list/pull/info/remove` + memory safety gate (refuse >18 GB, warn <2 GB headroom) |
| 3 | LoRA adaptor framework | ✅ Done | `adaptor install/list/update/info/remove/train/eval` done; `--adaptor` flag wired; composite quality scorer built |
| 4 | Dataset curation tooling | ✅ Done | `data ingest/extract/deduplicate/validate/split/stats` |
| 5 | Adaptor training pipeline | ✅ Done | `coder adaptor train --config <path>` with loss streaming, checkpoint resumption, manifest version bump |
| 6 | Quality scoring and eval harness | ✅ Done | `coder adaptor eval <name>` — tsc/eslint/bun-test composite scorer; `--baseline` flag; `eval_complete` observability event |
| 7 | Observability | ✅ Done | Structured JSON logger, TTFT, tok/s, `coder logs` command |

### What is implemented

- `coder generate "<prompt>" [--model <path>]` — spawns `mlx_lm.generate`, parses stdout, prints to stdout
  - `--stream` — streams tokens via Bun ReadableStream; TTFT measured from spawn to first chunk
  - `--adaptor <name>` — resolves adaptor path from `adaptors_dir` config, passes `--adapter-path` to mlx_lm
  - `-o <file>` — writes output to file instead of stdout
  - `--context <file>` — prepends file content to prompt (repeatable)
  - `--system <file>` — passes system prompt file to mlx_lm via `--system-prompt`
- `coder chat [--adaptor <name>]` — interactive multi-turn REPL
  - Streaming by default via `runMlxStream`
  - Conversation history formatted as ChatML (`<|im_start|>user...<|im_end|>`), passed with `--ignore-chat-template`
  - Sliding window truncation at 6,000 tokens with WARN log
  - `/clear`, `/save <file>`, `/exit`, Ctrl-C (cancel generation), Ctrl-D (quit)
- `coder config set/get/show` — reads/writes `~/.coder/config.toml` via smol-toml; env overrides; XDG-aware path; `~` expansion
- `coder models list/pull/info/remove` — HuggingFace HTTP download (streaming to disk with progress), memory estimates
- `coder adaptor list/install/info/update/remove` — git-based install, Zod manifest validation, adaptors_dir management
- `coder adaptor eval <name> [--baseline] [--input <file>]` — generates output for each eval prompt, scores via tsc/eslint/bun-test (weights 0.4/0.3/0.3), prints table, writes `eval_pass_rate` (or `baseline_pass_rate`) to manifest; `CODER_DRY_RUN=1` returns 0.5 for all dimensions
- `coder logs` — streams `~/.coder/logs/coder.log` to stdout
- `coder data ingest <glob>` — walks source files, one JSONL record per file (skips binary + >100KB)
- `coder data extract --adaptor <name>` — applies `extract.json` rules; prompt anchors: `jsdoc`, `line_comment`, `ts_declare`; completion anchors: `next_function`, `next_block`, `declare_body`, `constructor_call`
- `coder data deduplicate <file>` — exact dedup + Jaccard trigram near-dedup (threshold 0.85)
- `coder data validate <file>` — gates non-empty fields and ≤2048 token limit (chars/4)
- `coder data split <file>` — Fisher-Yates deterministic shuffle (seed 42), 90/10 train/eval split
- `coder data stats <file>` — count, mean/p50/p95 token lengths, duplicate rate
- `coder adaptor train --config <path>` — LoRA fine-tuning via `mlx_lm.lora`; Zod-validated TOML config; auto-generates YAML for LoRA hyperparams; streams loss lines to training log; checkpoint resumption (auto-detects `adaptor.safetensors`); bumps manifest patch version on completion; `training_step` + `training_complete` observability events
- Memory safety gate — `modelDiskBytes × 1.2 + adaptorBytes`; refuses >18 GB, warns <2 GB headroom; bypassed by `CODER_DRY_RUN=1`
- Preflight check — verifies `python3` and `mlx_lm` present before first subprocess spawn; cached per process
- Structured JSON logger — `generation_start` / `generation_complete` events (TTFT, tok/s) to `~/.coder/logs/coder.log`
- 276 tests (unit + integration), `tsc --noEmit` clean, ESLint clean

### What does not exist yet

- Performance benchmark harness (#14)
- react-ts adaptor pack (#11): code complete (extract anchors + pack structure in `adaptors/react-ts/`) — data curation + training runtime steps pending
- GraphQL adaptor pack (#12): blocked by #11 runtime completion

**Rough completion: ~90% of the full platform.**

---

## Backlog overview

### Phase 1 — Foundation ✅

| Issue | Title | Status |
|---|---|---|
| [#5](https://github.com/falese/coder/issues/5) | Config management | ✅ Done |
| [#3](https://github.com/falese/coder/issues/3) | Models: list, pull, info, remove | ✅ Done |
| [#15](https://github.com/falese/coder/issues/15) | Memory safety gate | ✅ Done |
| [#10](https://github.com/falese/coder/issues/10) | Observability: structured logging | ✅ Done |
| [#17](https://github.com/falese/coder/issues/17) | Preflight: python3 + mlx_lm check | ✅ Done |

### Phase 2 — Core UX ✅

| Issue | Title | Status |
|---|---|---|
| [#2](https://github.com/falese/coder/issues/2) | Generate: streaming, flags, file output, context | ✅ Done |
| [#4](https://github.com/falese/coder/issues/4) | Chat: interactive multi-turn REPL | ✅ Done |
| [#6](https://github.com/falese/coder/issues/6) | Adaptor: install, list, update, info, remove | ✅ Done |

### Phase 3 — Infrastructure

| Issue | Title | Status |
|---|---|---|
| [#13](https://github.com/falese/coder/issues/13) | CI: GitHub Actions workflow | ✅ Done |
| [#14](https://github.com/falese/coder/issues/14) | Perf: benchmark harness | 🔴 Open |

### Phase 4 — Adaptor platform

| Issue | Title | Status |
|---|---|---|
| [#7](https://github.com/falese/coder/issues/7) | Data: JSONL curation pipeline | ✅ Done |
| [#8](https://github.com/falese/coder/issues/8) | Adaptor train: LoRA training pipeline | ✅ Done |
| [#9](https://github.com/falese/coder/issues/9) | Adaptor eval: quality scoring harness | ✅ Done |

### Phase 5 — Domain adaptor packs

| Issue | Title | Status |
|---|---|---|
| [#11](https://github.com/falese/coder/issues/11) | React/TS adaptor pack | 🟡 In progress — code done, data curation + training pending |
| [#12](https://github.com/falese/coder/issues/12) | GraphQL adaptor pack | 🔴 Blocked by #11 |
| [#16](https://github.com/falese/coder/issues/16) | Adaptor registry protocol (design spike) | 🔴 Open — design only |

---

## Items needing further definition

All Phase 4 design decisions are resolved. Remaining open items relate to Phase 5 domain adaptor packs.

---

## Dependency map

```
#5 config ✅
#3 models ✅
#15 memory gate ✅
#17 preflight ✅
#2 generate (streaming) ✅
#10 observability ✅
#6 adaptor (install/list/info) ✅
#4 chat ✅

#13 CI — independent, do next
#14 benchmark — depends on #10 ✅

#7 data pipeline
  └── needs: data extract heuristics defined
  └── unblocks: #11, #12

#8 adaptor train
  └── depends on: #6 ✅, #7

#9 adaptor eval ✅

#11 react-ts adaptor
  └── depends on: #7 ✅, #8 ✅, #9 ✅

#12 graphql adaptor
  └── depends on: #11
```
