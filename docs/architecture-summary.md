# Coder — Technical Architecture Summary

> Version 1.0 — 2026-03-23
> Audience: engineering managers, platform leads, technical investors
> Note: this is an executive-readable summary. Full technical specification: docs/spec.md

---

## The Core Insight: Separation of Model and Domain Knowledge

Most AI coding tools bundle general intelligence and domain knowledge together in a single large model. This creates a dilemma: the model is either too generic to be useful for specialised work, or it is so large and expensive to update that it cannot track evolving codebases.

Coder separates these concerns:

- **The base model** (7B parameters, publicly available, fixed) provides language understanding and code generation capability.
- **The LoRA adaptor** (2–4MB, trained by your team, versioned) encodes your domain's patterns, conventions, and architecture decisions.

The adaptor is loaded on top of the base model at inference time in milliseconds. Updating domain knowledge means training a new adaptor — not retraining a 7B model.

---

## Hardware and Cost Model

Coder is designed to run on hardware every senior engineer already owns: a MacBook Pro with Apple Silicon.

| Component | Requirement |
|---|---|
| Device | MacBook Pro M3, M4, or M5 |
| Memory | 18GB unified memory (standard configuration) |
| Storage | ~5GB per base model (4-bit quantised) |
| Training time | 30–60 minutes per adaptor on M3 |
| Inference cost | $0 per query (local compute) |
| Cloud dependency | None (after initial model download) |

**Comparison to cloud alternatives:**
- GitHub Copilot Enterprise: ~$39/user/month
- Cursor Business: ~$40/user/month
- Self-hosted GPU inference: $500–2,000/month per team (A100 or equivalent)

At 10 engineers, Coder's marginal cost after hardware is approximately $0/month. Break-even against Copilot Enterprise is achieved immediately for teams that already own M-series MacBooks.

---

## Privacy Architecture

All inference, training, and data processing runs locally. There are no network calls during code generation.

```
Engineer's MacBook
┌─────────────────────────────────────────────┐
│  coder CLI (TypeScript/Bun)                  │
│       │                                      │
│  LoRA adaptor (2–4MB, your domain)           │
│       │                                      │
│  Base model (7B params, 4-bit, ~5GB)         │
│       │                                      │
│  MLX inference runtime (Apple framework)     │
└─────────────────────────────────────────────┘
         │
         ▼
    Generated code
    (never leaves the machine)
```

The only network call in the entire workflow is the initial model download from HuggingFace — a one-time operation using standard HTTPS, equivalent to downloading a package.

**What stays local, always:**
- All prompts
- All generated code
- All training data
- All eval results
- All logs

---

## Adaptor Lifecycle

The adaptor is the unit of domain knowledge distribution. Its lifecycle has five stages:

### 1. Data extraction
The engineer runs `coder data extract --adaptor <name>`. Coder scans your codebase using rule-based anchors (JSDoc comments, TypeScript declarations, constructor calls) and produces structured training pairs in JSONL format.

### 2. Training
`coder adaptor train --config <path>` invokes LoRA fine-tuning via the `mlx_lm.lora` toolchain. On an M3 MacBook Pro, a 144-record training set completes in under an hour. Checkpoint resumption is automatic.

### 3. Evaluation
`coder adaptor eval <name>` runs a composite quality score:
- **TypeScript type correctness** (40%) — `tsc --noEmit` against the adaptor's generated output
- **ESLint compliance** (30%) — adaptor-supplied ruleset
- **Test suite pass rate** (30%) — `bun test` against the adaptor's eval suite

The `--baseline` flag measures the score without the adaptor loaded, enabling before/after lift measurement. The react-ts reference adaptor achieves a lift of +0.460 (baseline 0.460 → adaptor 0.920).

### 4. Distribution
Adaptors are self-contained directories versioned in git. Installation is a single command:

```
coder adaptor install --from-git https://github.com/your-org/react-ts-adaptor
```

A hosted registry (v2) will enable `coder adaptor install react-ts` without a URL.

### 5. Invocation
```
coder generate "add a MUI DataGrid with server-side pagination" --adaptor react-ts
```

The adaptor is loaded in milliseconds. Generated code conforms to the domain patterns encoded during training.

---

## Integration Points

| System | Integration method | Notes |
|---|---|---|
| VS Code (planned v2) | Extension calling CLI | Inline diff review, ghost text |
| CI/CD pipelines | CLI invokable in any shell | Dry-run mode available |
| HuggingFace | HTTP API (model download only) | No inference traffic |
| Git repositories | `git clone` for adaptor install | No custom protocol |
| Internal model registries | Local path via config | `default_model` in `~/.coder/config.toml` |

---

## Security Properties

- **No credentials required** for local inference
- **No telemetry** — structured logs written to `~/.coder/logs/` only, never transmitted
- **Memory safety gate** — refuses to load a model+adaptor combination that would exceed 18GB; warns if headroom drops below 2GB
- **Dry-run mode** (`CODER_DRY_RUN=1`) — all operations simulate without executing; safe for CI environments and policy review
- **Adaptor isolation** — each adaptor is a directory; no code execution at install time
