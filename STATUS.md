# Coder — Project Status

> Last updated: 2026-03-21

---

## Progress against base prompt

The base prompt defines seven objectives. Status tracked below.

| # | Objective | Status | Notes |
|---|---|---|---|
| 1 | CLI framework | 🟡 In progress | `generate` (buffered + streaming) + config + model management done; `--adaptor` flag wired to path resolver but LoRA loading not yet built |
| 2 | Model management | ✅ Done | `models list/pull/info/remove` + memory safety gate (refuse >18 GB, warn <2 GB headroom) |
| 3 | LoRA adaptor framework | 🔴 Not started | `adaptor install/list/update/train/eval` not yet built |
| 4 | Dataset curation tooling | 🔴 Not started | No JSONL pipeline |
| 5 | Adaptor training pipeline | 🔴 Not started | No `mlx_lm.lora` wrapper |
| 6 | Quality scoring and eval harness | 🔴 Not started | No scorer, no eval suite runner |
| 7 | Observability | ✅ Done | Structured JSON logger (`~/.coder/logs/coder.log`), TTFT, tok/s; `coder logs` command |

### What is implemented

- `coder generate "<prompt>" [--model <path>]` — spawns `mlx_lm.generate`, parses stdout, prints to stdout
  - `--stream` — streams tokens via Bun ReadableStream as they arrive; TTFT measured from spawn to first chunk
  - `--adaptor <name>` — resolves adaptor path from `adaptors_dir` config and passes to mlx_lm
  - `-o <file>` — writes output to file instead of stdout
  - `--context <file>` — prepends file content to prompt (repeatable flag)
  - `--system <file>` — passes system prompt file to mlx_lm
- `parseMlxOutput` — pure parser for mlx_lm output format with token/s extraction
- `runMlx` / `runMlxBuffered` — buffered subprocess runner with actionable error handling
- `runMlxStream` — streaming subprocess runner; returns `{ stream: ReadableStream<string>, result: Promise<GenerateResult> }`
- Dry-run mode via `CODER_DRY_RUN=1` for integration testing without a real model
- `coder config set/get/show` — reads/writes `~/.coder/config.toml` via smol-toml; env overrides; XDG-aware path; `~` expansion
- `coder models list` — scans `models_dir`, reports name, quant, disk size, memory estimate
- `coder models pull <repo-id>` — downloads from HuggingFace via native HTTP API (no Python subprocess)
- `coder models info <name>` — parses `config.json`, reports model type, quant bits, disk size, memory estimate
- `coder models remove <name>` — deletes a model directory
- Memory safety gate — checks `modelDiskBytes × 1.2 + adaptorBytes` before every generation; refuses >18 GB, warns when headroom <2 GB; bypassed by `CODER_DRY_RUN=1`
- Structured JSON logger — appends `generation_start` and `generation_complete` events (with TTFT, tok/s) to `~/.coder/logs/coder.log`; human-readable messages to stderr at configured log level
- `coder logs` — streams `~/.coder/logs/coder.log` to stdout
- 93 tests (unit + integration), `tsc --noEmit` clean, ESLint clean

### What does not exist yet

- LoRA adaptor loading (path resolution done; actual mlx_lm `--adapter` flag wiring to `chat/adaptor train` not yet built)
- `chat`, `adaptor`, `data` commands

**Rough completion: ~40% of the full platform.**

---

## Backlog overview

11 open issues across four phases.

### Phase 1 — Foundation (unblock everything else)

| Issue | Title | Assessment |
|---|---|---|
| [#5](https://github.com/falese/coder/issues/5) | Config management (`~/.coder/config.toml`) | ✅ **Done** (f235cd1) |
| [#3](https://github.com/falese/coder/issues/3) | Models: list, pull, info, memory reporting | ✅ **Done** |
| [#15](https://github.com/falese/coder/issues/15) | Memory safety gate | ✅ **Done** |
| [#10](https://github.com/falese/coder/issues/10) | Observability: structured logging and metrics | ✅ **Done** |

### Phase 2 — Core UX

| Issue | Title | Assessment |
|---|---|---|
| [#2](https://github.com/falese/coder/issues/2) | Generate: streaming, `--adaptor`, file output, context | ✅ **Done** |
| [#4](https://github.com/falese/coder/issues/4) | Chat: interactive multi-turn REPL | Significant hidden complexity (see below). |

### Phase 3 — Adaptor platform

| Issue | Title | Assessment |
|---|---|---|
| [#6](https://github.com/falese/coder/issues/6) | Adaptor: install, list, update, info + manifest validation | Well scoped. Zod already in package.json. |
| [#7](https://github.com/falese/coder/issues/7) | Data: JSONL curation pipeline | The `data extract` command is underdefined (see below). |

### Phase 4 — Training loop and quality

| Issue | Title | Assessment |
|---|---|---|
| [#8](https://github.com/falese/coder/issues/8) | Adaptor train: LoRA training pipeline | Well scoped. Checkpoint resumption needs mlx_lm.lora flag investigation. |
| [#9](https://github.com/falese/coder/issues/9) | Adaptor eval: quality scoring harness | Most complex issue in the backlog. Significantly underdefined (see below). |
| [#10](https://github.com/falese/coder/issues/10) | Observability: structured logging and metrics | ✅ **Done** |

### Phase 5 — Domain adaptor packs

| Issue | Title | Assessment |
|---|---|---|
| [#11](https://github.com/falese/coder/issues/11) | React/TS adaptor pack | Platform must be complete first. Data sourcing is vague (see below). |
| [#12](https://github.com/falese/coder/issues/12) | GraphQL adaptor pack | Blocked by #11. Same data sourcing concerns apply. |

---

## Items needing further definition

### 🔴 High priority — blocks implementation

#### #4 Chat: chat template handling
The issue says "detect chat template from `tokenizer_config.json`". In practice, chat templates are Jinja2 strings embedded in the tokenizer config and vary significantly across model families. The implementation needs a decision:
- **Option A:** Shell out to Python: `python -c "from mlx_lm import load; ..."` to apply the template server-side before passing to `mlx_lm.generate` — avoids re-implementing Jinja2 in TypeScript
- **Option B:** Hard-code templates for the two supported models (Qwen2.5-Coder, DeepSeek-Coder) and refuse others
- **Option C:** Accept a raw `--system` prompt and delegate formatting to mlx_lm's built-in chat template handling

**Recommendation:** Option C for v1. Needs a decision before #4 can be estimated.

#### #4 Chat: context window overflow
The issue is silent on what happens when conversation history exceeds the model's context window (typically 8k–32k tokens for 7B models). Without a truncation strategy, the chat command will silently degrade or error mid-session. Needs a defined behaviour (e.g. sliding window, summarisation, hard stop with warning).

#### #7 Data: `data extract` heuristics
The issue says "applies heuristics to split files into prompt/completion pairs (e.g. comment → code block)". This is a non-trivial NLP problem. The heuristic is completely unspecified:
- What constitutes a "prompt"? A JSDoc comment? A `// TODO` line? A function signature?
- What constitutes a "completion"? The function body? The whole file?
- How are boundaries detected?

This needs concrete extraction rules defined before implementation. Suggested approach: define a small DSL in the adaptor's `prompts/system.md` that specifies extraction patterns, rather than one-size-fits-all heuristics. **Needs a design spike before #7 can proceed.**

#### #9 Adaptor eval: embedding similarity scorer
The issue proposes TF-IDF cosine similarity as a v1 "fallback". In practice, TF-IDF similarity of code is a weak signal — two functionally identical React components written differently will score poorly. This scoring dimension (0.15 weight) may not be worth implementing in v1 given the implementation cost vs. signal quality. The issue needs a decision:
- **Option A:** Drop embedding similarity from v1; composite score is tsc + eslint + test pass rate only (renormalise weights)
- **Option B:** Use a lightweight local embedding model (e.g. `all-MiniLM-L6-v2` via Python subprocess)
- **Option C:** Keep TF-IDF but mark the score as `experimental` in output

**Recommendation:** Option A for v1. Reduces scope significantly without compromising the three high-signal dimensions.

#### #9 Adaptor eval: eval suite format
The issue says `evals/eval_suite.ts` is "run with `bun test`" but doesn't specify how generated code is injected into the test. How does the test file reference generated output? Options:
- Generated file written to a known temp path; test imports from that path
- Test receives generated code as a string via env var
- Each eval record generates a file, runs the test, then deletes it

This needs a concrete format spec with an example before adaptor authors can write eval suites. **Needs a design decision before #9 and #11/#12 can proceed.**

---

### 🟡 Medium priority — needs clarification before sprint

#### #8 Adaptor train: checkpoint resumption
`mlx_lm.lora` supports `--resume-adapter-file` to continue training from an existing adaptor file. The issue says "training can be resumed if `weights/adaptor.safetensors` already exists" but doesn't specify whether this is automatic or requires a `--resume` flag. Needs a decision.

---

### 🟢 Low priority — gaps to address eventually

#### Missing issue: CI/CD pipeline
No issue exists for GitHub Actions. A basic workflow (install deps, `bun test`, `tsc --noEmit`, `eslint .`) on every push is a gap. Should be added to the backlog.

#### Missing issue: performance benchmarking
The base prompt specifies hard performance targets (first token < 2s, sustained > 20 tok/s on M3). No issue tracks measuring or validating these targets against a real model. The observability issue (#10) captures the metric emission, but there is no issue for a benchmark harness or pass/fail gate.

#### Missing issue: memory safety check
~~The base prompt specifies an 18 GB memory constraint and requires the CLI to expose memory usage. No issue tracks enforcing this.~~ ✅ Addressed by #15: `checkMemory` enforces the gate before every generation.

#### #6 Adaptor install: registry protocol undefined
The issue notes "future: hosted registry with `coder adaptor install <name>` resolution" but gives no detail on the registry API, discovery mechanism, or namespace. This is intentionally deferred but should be stubbed as a separate issue so it doesn't get designed ad-hoc when someone tries to implement it.

---

## Dependency map

```
#5 config ✅
  └── unblocked: all other commands (--model becomes optional)

#3 models ✅
  └── unblocked: #11, #12 (need a real model downloaded)

#15 memory safety gate ✅
  └── enforced in generate command before every mlx_lm spawn

#2 generate (streaming + adaptor flag + file output + context) ✅
  └── depends on: #5 config ✅, #6 adaptor commands (path resolution done)

#10 observability ✅
  └── co-implemented with #2 (streaming refactor enabled TTFT measurement)

#4 chat
  └── depends on: #5 config ✅, #2 generate ✅ (shares streaming + adaptor infrastructure)
  └── needs: chat template decision (resolved: Option C)

#6 adaptor (install/list/info)
  └── depends on: #5 config ✅ (adaptors_dir path)
  └── unblocks: #8 train, #9 eval, #11, #12

#7 data pipeline
  └── independent — can start anytime
  └── needs: `data extract` heuristics defined (see above)
  └── unblocks: #11, #12

#8 adaptor train
  └── depends on: #6 adaptor, #7 data pipeline

#9 adaptor eval
  └── depends on: #6 adaptor, #8 train
  └── needs: eval suite format defined, embedding scorer decision (see above)

#11 react-ts adaptor
  └── depends on: #2 ✅, #6, #7, #8, #9 (full platform)

#12 graphql adaptor
  └── depends on: #11
```

---

## Recommended next actions

1. **Implement #4 chat** — streaming and adaptor infrastructure from #2 is now done; chat template (Option C) is resolved.
2. **Implement #6 adaptor install/list/update** — unblocks train, eval, and the domain adaptor packs.
3. **Resolve `data extract` heuristics (#7)** before implementing the data pipeline — design spike required.
4. **Create two missing issues** — CI/CD pipeline, performance benchmarking — before the backlog is considered complete.
