# Coder — Product Roadmap

> Version 1.0 — 2026-03-23
> Audience: engineering managers, platform leads, investors

---

## Summary

| Milestone | Theme | Status |
|---|---|---|
| v1 | Foundation: local inference + adaptor lifecycle | Complete |
| v2 | Distribution: hosted registry + IDE integration | Planning |
| v3 | Platform: team management + enterprise controls | Future |
| v4 | Ecosystem: marketplace + community | Future |

---

## v1 — Foundation (Complete, 2026-03-22)

**Theme:** Prove the end-to-end loop works on a single machine.

The full adaptor lifecycle is operational:

- **Inference**: `coder generate` with streaming, adaptor selection, context files, system prompts
- **Model management**: HuggingFace download, list, info, remove (`coder models`)
- **Adaptor management**: install from git, update, remove, info (`coder adaptor`)
- **Training**: LoRA fine-tuning via mlx_lm with checkpoint resumption (`coder adaptor train`)
- **Evaluation**: composite quality score (TSC + ESLint + test suite), baseline comparison (`coder adaptor eval`)
- **Data pipeline**: ingest, extract (4 anchor types), deduplicate, validate, split, stats (`coder data`)
- **Chat**: multi-turn REPL with sliding context window (`coder chat`)
- **Observability**: structured JSON logs, TTFT, tok/s, quality score, training loss
- **Reference adaptor**: react-ts — 144 MUI training records, composite 0.920, lift +0.460

**What v1 proves:** A domain expert can encode their architecture patterns into a 2–4MB adaptor in under an hour, and that adaptor measurably improves generated code quality against a blind baseline.

---

## v2 — Distribution (Target: Q3 2026)

**Theme:** Make adaptors easy to share, discover, and install.

### Hosted adaptor registry

- `coder adaptor install react-ts` — no git URL required
- Registry hosts versioned, signed adaptor packs
- `coder adaptor search <keyword>` — browse community and enterprise listings
- Adaptor pages show composite eval scores, download counts, and author metadata

### VS Code extension

- Inline `coder generate` via keyboard shortcut
- Ghost text suggestions using active adaptor
- Diff view for generated code before acceptance
- Adaptor selector in status bar

### GraphQL adaptor pack

- Second reference domain: validates multi-domain platform story
- Schema-aware extraction anchors: type definitions, resolver stubs, directive patterns
- Targeting composite score ≥ 0.85

### Developer experience improvements

- `coder adaptor new <domain>` — scaffolds pack skeleton (extract.json, manifest, eval suite template)
- `coder adaptor publish` — submits pack to hosted registry
- `--watch` mode for iterative adaptor development

---

## v3 — Platform (Target: H1 2027)

**Theme:** Move from individual tool to team platform.

### Team adaptor management

- Shared adaptor library per organisation
- Version pinning: teams lock to specific adaptor versions
- Adaptor promotion workflow: dev → staging → production
- Audit log: who generated what, with which adaptor and model

### Enterprise controls

- SSO integration (SAML / OIDC)
- Role-based access: adaptor admin, developer, read-only
- Policy enforcement: restrict generation to approved adaptors
- Air-gapped deployment: full offline operation including registry

### Multi-model support

- DeepSeek-Coder-V2-Lite as alternative base model
- Model benchmarking: `coder models compare <a> <b>` runs eval suite against both
- Model recommendation: suggest optimal base model given adaptor domain

### Adaptor quality programme

- Automated quality gates on registry publish: minimum composite score threshold
- Adaptor leaderboard by domain
- Regression tracking: alert when a new adaptor version drops quality below previous

---

## v4 — Ecosystem (Target: 2027+)

**Theme:** Community marketplace with network effects.

### Community marketplace

- Open community adaptor publishing
- Paid tiers for enterprise-grade adaptors with SLA
- Adaptor collections: curated domain bundles (e.g., "AWS Platform Pack", "React Design System Pack")
- Revenue sharing for adaptor authors

### Advanced adaptor capabilities

- Multi-model adaptor testing: eval suite runs against multiple base models automatically
- Adaptor composition (limited): layer a base domain adaptor with a style adaptor
- Continuous training: scheduled re-training as source codebase evolves
- Retrieval augmentation (optional, local): on-device vector store for large codebase context

### Platform integrations

- JetBrains IDE plugin
- GitHub Actions integration: `coder generate` in PR workflows
- Linear / Jira: generate code stubs from ticket descriptions
- Slack bot: request generation from within team channels

---

## What is Explicitly Not on the Roadmap

- Cloud inference or remote model hosting (the privacy guarantee is structural, not a setting)
- Windows or Linux before the Mac product is established
- Proprietary model training (Coder uses publicly available base models — the IP is the adaptor toolchain and marketplace)
- Replacing code review (Coder generates; humans review and merge)
