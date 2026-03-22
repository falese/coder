# Coder — Product Requirements Document

> Version 1.0 — 2026-03-23
> Audience: investors, engineering managers, platform leads

---

## Problem Statement

Enterprise software teams are under mounting pressure to accelerate delivery without sacrificing code quality or exposing intellectual property to third-party cloud services. Today's mainstream AI coding tools — GitHub Copilot, Cursor, Claude — are powerful but share a critical flaw: **every prompt, every code snippet, every architectural pattern is transmitted to an external server.**

For regulated industries (finance, healthcare, defence), IP-sensitive organisations (startups, ISVs), and teams with strict data-residency requirements, this is not a minor inconvenience. It is a blocker.

Simultaneously, generic models trained on public code perform poorly on specialised codebases. A model trained on millions of open-source repositories does not know your team's component library, your GraphQL schema conventions, or the Module Federation architecture of your micro-frontend platform.

**The result:** teams either accept privacy risk and poor domain accuracy, or they give up AI assistance entirely.

---

## Vision

Coder is a local-first AI code generation platform that enables any engineering team to run domain-specific code generation **entirely on their own hardware**, with zero data leaving the machine.

The long-term goal is a community marketplace of fine-tuned LoRA adaptor packs — authored by domain experts, distributed like packages, and pulled by any engineer in minutes.

---

## Target Personas

### Primary: The Platform Engineer

- Owns the internal developer platform at a mid-to-large engineering org
- Responsible for standardising tooling, enforcing architecture patterns, and reducing the cost of onboarding
- Currently frustrated that Copilot-style tools generate code that doesn't follow internal conventions
- Success metric: engineers generate compliant code on the first attempt, reducing review cycles

### Secondary: The Engineering Manager / VP Engineering

- Accountable for delivery velocity and code quality
- Has rejected cloud AI tools on legal or security grounds, or has approved them reluctantly with caveats
- Looking for a productivity story that satisfies the security team
- Success metric: measurable lift in code quality scores and reduced rework

### Tertiary: The Domain Expert / Adaptor Author

- Deep knowledge of a specific library, framework, or architectural pattern
- Wants to encode team knowledge into a reusable artefact — not a document, but a deployable capability
- Success metric: publishes an adaptor pack that other teams adopt and rate highly

### Adjacent: The Individual Developer / OSS Contributor

- Privacy-conscious or working in an air-gapped environment
- Wants local inference without giving up code intelligence
- Entry point to the platform; may later contribute adaptors

---

## Value Propositions

| Pain | Coder's answer |
|---|---|
| Cloud AI tools exfiltrate code and prompts | 100% local inference — no network calls during generation |
| Generic models don't know your conventions | Domain-specific LoRA adaptors trained on your own codebase |
| Fine-tuning requires ML expertise and cloud GPUs | CLI-driven training on a standard MacBook Pro, 30–60 min per adaptor |
| Team knowledge lives in wikis no one reads | Encode architecture patterns as a deployable, versioned adaptor pack |
| Adaptor ROI is locked to one team | Marketplace distribution — publish once, any team installs in one command |

---

## P0 — Must Have (v1, current)

These are shipped or in final integration:

- `coder generate` — local inference with adaptor selection, streaming, context files, system prompt
- `coder models` — HuggingFace download, list, info, remove
- `coder adaptor` — install (git), train (LoRA via mlx_lm), eval (composite score: TSC + ESLint + test suite)
- `coder data` — ingest, extract, deduplicate, validate, split, stats
- Memory safety gate — refuse to load if model + adaptor exceeds 18GB unified memory
- Structured observability — TTFT, tok/s, quality score, training loss
- react-ts reference adaptor — 144 MUI training records, composite score 0.920, lift +0.460 over baseline

---

## P1 — High Priority (v2)

- **Hosted adaptor registry** — `coder adaptor install <name>` without a git URL; versioned, signed packages
- **IDE extension** — VS Code integration exposing `coder generate` inline; inline diff review
- **GraphQL adaptor pack** — second reference domain; validates multi-domain platform story
- **Chat REPL** — `coder chat` for iterative, multi-turn code generation with session context
- **Adaptor quality badge** — public eval score displayed in marketplace listings

---

## P2 — Planned (v3–v4)

- **Team adaptor management** — shared adaptor library per org, access control, version pinning
- **Adaptor authoring guide + scaffolding CLI** — `coder adaptor new <domain>` generates the pack skeleton
- **Multi-model support** — DeepSeek-Coder-V2-Lite as alternative base; model performance comparison tooling
- **Windows / Linux support** — post-Apple-Silicon launch; requires non-MLX inference backend
- **Enterprise SSO + audit log** — for platform-wide rollout at regulated organisations

---

## Non-Goals (v1)

- Cloud inference or API-based model backends
- RAG pipelines or vector store retrieval
- Multi-adaptor composition in a single session
- Hosted registry infrastructure (planned for v2)
- Windows or Linux support
- Embedding similarity scoring (field reserved; scorer dropped)
- Jinja2 re-implementation in TypeScript

---

## Success Metrics

| Metric | v1 target | v2 target |
|---|---|---|
| Adaptor eval composite score | ≥ 0.85 | ≥ 0.90 |
| Lift over baseline | ≥ +0.15 | ≥ +0.20 |
| TTFT (first token) | < 2s | < 1.5s |
| Throughput | > 20 tok/s | > 30 tok/s |
| Adaptor install time (git) | < 30s | < 10s (registry) |
| Community adaptor packs | 2 (react-ts, graphql) | 10+ |
