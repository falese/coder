# Coder — Spec

> Last updated: 2026-03-21

---

## Context

Small local models are the next frontier for production code generation. They offer privacy, zero usage cost, and elimination of hallucination risk that makes mass-market tools unsuitable for production codebases. The goal is a platform — not just a tool — where domain expert teams build, publish, and distribute fine-tuned LoRA adaptor packs via a community marketplace, enabling any engineer to pull a domain-specific adaptor and generate code that adheres to that domain's architecture, patterns, and quality standards.

First adaptor domains: **React/TypeScript** and **GraphQL** (separate adaptors, selected at invocation).

---

## Hardware and runtime

| Constraint                   | Value                                                     |
| ---------------------------- | --------------------------------------------------------- |
| Device                       | MacBook Pro, Apple Silicon M3–M5                          |
| Memory                       | 18GB unified memory                                       |
| Inference runtime            | MLX                                                       |
| Model size                   | 7B parameters                                             |
| Recommended base models      | Qwen2.5-Coder-7B, DeepSeek-Coder-V2-Lite (MLX-quantized)  |
| TTFT target                  | < 2s                                                      |
| Throughput target            | > 20 tok/s sustained                                      |
| Max memory (model + adaptor) | 18GB — refuse to load if exceeded, warn if headroom < 2GB |

---

## LoRA adaptor specification

### Training config

- Rank: r=8 (~2–4MB adaptor, ~30–60 min training on M3)
- Target modules: query and value projection layers
- Toolchain: `mlx_lm.lora`
- Data format: JSONL `{"prompt": "...", "completion": "..."}`
- Checkpoint resumption: automatic — pass `--resume-adapter-file` when `weights/adaptor.safetensors` exists

### Adaptor pack structure

```
adaptor-pack/
├── weights/
│   └── adaptor.safetensors
├── data/
│   ├── train.jsonl
│   └── eval.jsonl
├── evals/
│   └── eval_suite.ts
├── prompts/
│   └── system.md          # system prompt + data extract DSL patterns
└── manifest.json
```

### Manifest schema

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
  "embedding_similarity": null,
  "author": "",
  "description": ""
}
```

### Eval suite injection format

The CLI writes generated output to a temp file, sets `CODER_EVAL_OUTPUT`, runs `bun test evals/eval_suite.ts`, captures pass/fail, then deletes the temp file.

```typescript
// evals/eval_suite.ts — canonical format for all adaptor authors
const generatedPath = process.env.CODER_EVAL_OUTPUT;
if (!generatedPath) throw new Error("CODER_EVAL_OUTPUT not set");
const { default: generated } = await import(generatedPath);
// assertions against `generated` follow
```

### Quality composite score (v1)

| Dimension                   | Weight | Implementation                            |
| --------------------------- | ------ | ----------------------------------------- |
| TypeScript type correctness | 40%    | `tsc --noEmit`                            |
| ESLint compliance           | 30%    | ESLint with adaptor ruleset               |
| Test pass rate              | 30%    | `bun test evals/eval_suite.ts`            |
| Embedding similarity        | —      | Dropped from v1, field reserved as `null` |

---

## CLI command surface

```
coder generate "<prompt>" [--adaptor <n>] [-o <file>] [--context <file>] [--model <path>]
coder chat [--adaptor <n>]
coder models list
coder models pull <hf-repo-id>
coder models info <name>
coder config set <key> <value>
coder config get <key>
coder adaptor list
coder adaptor install --from-git <url>
coder adaptor update <name>
coder adaptor info <name>
coder adaptor train --config <path>
coder adaptor eval <name>
coder data ingest <dir>
coder data validate <file>
coder data split <file>
```

---

## Config file (`~/.coder/config.toml`)

```toml
default_model = ""          # HF repo id or local path
adaptors_dir = "~/.coder/adaptors"
log_level = "info"          # debug | info | warn | error
```

CLI flags override config. Config overrides built-in defaults.

---

## Observability

All generation and training workflows emit structured JSON log lines to `~/.coder/logs/coder.log`.

```json
{
  "ts": "...",
  "event": "generate",
  "ttft_ms": 1240,
  "tok_s": 28.4,
  "adaptor": "react-ts",
  "model": "Qwen2.5-Coder-7B"
}
```

Required metrics:

- `ttft_ms` — time from subprocess spawn to first non-empty stdout chunk
- `tok_s` — sustained tokens per second
- `adaptor_load_ms` — LoRA adaptor load time
- `quality_score` — composite score from eval dimensions
- `training_loss` — per-epoch loss curve (written during `adaptor train`)

`info` level to stderr, `debug` to log file.

---

## Adaptor marketplace

- **v1:** git-based distribution (`coder adaptor install --from-git <url>`)
- **Future:** hosted registry (`coder adaptor install <name>`) — protocol TBD, stub issue to be created
- Community teams build, curate, train, and publish adaptor packs
- Adaptors are versioned, self-contained, and independently installable

---

## Resolved design decisions

| Decision                    | Resolution                                                                      |
| --------------------------- | ------------------------------------------------------------------------------- |
| Chat template handling      | Option C — `--system` flag, delegate to mlx_lm built-in. No Jinja2 in TS.       |
| Context window overflow     | Sliding window at 6,000 tokens. WARN log on truncation. No summarisation in v1. |
| Model download mechanism    | Native HuggingFace HTTP API. No Python subprocess beyond mlx_lm.                |
| Embedding similarity scorer | Dropped from v1. Composite = tsc + eslint + test pass rate only.                |
| Streaming + TTFT            | Implement together in one PR. Refactor `runMlx` to Bun `ReadableStream`.        |
| Checkpoint resumption       | Automatic — no `--resume` flag needed from user.                                |
| `data extract` heuristics   | Per-adaptor DSL in `prompts/system.md`. Design spike required before #7.        |
| Eval injection format       | `CODER_EVAL_OUTPUT` env var pointing to temp file. See spec above.              |

---

## Definition of done

**A feature is complete when:**

- [ ] All tests pass
- [ ] `tsc --noEmit` clean
- [ ] ESLint clean
- [ ] Human review completed before merge
- [ ] Observability metrics emitted and visible in debug log
- [ ] `eval_pass_rate` updated in `manifest.json` where applicable

**A generated output is acceptable when:**

- [ ] Tests pass (TDD gate)
- [ ] Type-check clean
- [ ] ESLint clean
- [ ] Composite quality score above adaptor-defined threshold

---

## Out of scope

- RAG pipelines or vector store retrieval
- Cloud inference or API-based models
- Full model fine-tuning
- Multi-adaptor composition within a single session (v1)
- Hosted registry infrastructure (v1)
- Embedding similarity scorer (v1)
- Jinja2 re-implementation in TypeScript
- Windows or Linux support
