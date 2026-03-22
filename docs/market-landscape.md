# Coder — Market & Competitive Landscape

> Version 1.0 — 2026-03-23
> Audience: investors, engineering managers, platform leads

---

## Market Context

AI-assisted code generation has moved from experimental to mainstream in under three years. GitHub Copilot crossed 1 million paid subscribers in 2023. By 2025, the majority of enterprise engineering teams have trialled at least one AI coding tool. Yet adoption in regulated, IP-sensitive, and security-conscious organisations remains stalled — not from lack of interest, but from unresolved data privacy and accuracy concerns.

Two structural problems define the gap Coder targets:

1. **Privacy**: Every cloud-hosted tool sends prompts and code to an external inference endpoint. For financial services, healthcare, defence, and IP-intensive software companies, this is either prohibited by policy or legally risky.
2. **Domain accuracy**: General-purpose models generate code that compiles but doesn't conform to the team's actual architecture, library choices, and quality standards. The review cost offsets much of the productivity gain.

---

## Competitive Landscape

### Tier 1: Cloud AI Coding Assistants

| Product | Model | Deployment | Domain adaptation | Privacy |
|---|---|---|---|---|
| GitHub Copilot | GPT-4o / Claude | Cloud SaaS | None (generic) | Code sent to Microsoft/OpenAI |
| Cursor | GPT-4o / Claude | Cloud SaaS | None (generic) | Code sent to Cursor/Anthropic |
| Amazon CodeWhisperer | Amazon Titan | Cloud SaaS | Limited (AWS patterns) | Code sent to AWS |
| Tabnine | Proprietary | Cloud + optional self-hosted | Limited | Self-hosted option available |

**Assessment**: Dominant in market share, zero privacy guarantees for cloud tier, no mechanism for deep domain adaptation. Tabnine's self-hosted option is the closest competitor but lacks adaptor training tooling.

### Tier 2: Local Inference Tools

| Product | Model | Deployment | Domain adaptation | Privacy |
|---|---|---|---|---|
| Continue.dev | Ollama / any | Local | Prompt-only | Full — no egress |
| Ollama + Open WebUI | Any GGUF | Local | Prompt-only | Full — no egress |
| LM Studio | Any GGUF | Local | Prompt-only | Full — no egress |

**Assessment**: Solve the privacy problem. Do not solve the domain accuracy problem. No mechanism to fine-tune, distribute, or version domain-specific adaptors. These are inference front-ends, not platforms.

### Tier 3: Fine-Tuning Platforms

| Product | Deployment | Training infra | CLI integration | Adaptor distribution |
|---|---|---|---|---|
| Hugging Face AutoTrain | Cloud | GPU cloud | None | Manual |
| Axolotl | Cloud / self-hosted | GPU required | None | Manual |
| Unsloth | Cloud / local | GPU preferred | None | Manual |

**Assessment**: Solve the fine-tuning problem in isolation. Require ML expertise, cloud GPUs (typically), and produce model weights that engineers must manually integrate. No end-to-end developer workflow.

---

## Coder's Differentiation

Coder is the only tool that combines all three layers in a single, developer-native CLI:

| Capability | Cloud AI tools | Local inference tools | Fine-tuning platforms | Coder |
|---|---|---|---|---|
| Local inference (full privacy) | No | Yes | No | **Yes** |
| Domain-specific fine-tuning | No | No | Yes (complex) | **Yes (30–60 min, CLI)** |
| Adaptor distribution | No | No | No | **Yes (git → registry)** |
| Developer CLI workflow | Yes | Partial | No | **Yes** |
| Apple Silicon optimised | No | Partial | No | **Yes (MLX, 18GB)** |
| Eval harness (quality gate) | No | No | No | **Yes (composite score)** |

The moat is not the inference runtime — MLX and Ollama are both fast. The moat is the **adaptor lifecycle**: data extraction → training → evaluation → distribution → installation. No competitor owns this loop.

---

## Addressable Market

### Total Addressable Market (TAM)

The global developer tools market is estimated at $28B in 2025, growing at ~15% CAGR. AI coding assistants are the fastest-growing segment, projected to reach $12B by 2028 (source: analyst estimates, 2024).

### Serviceable Addressable Market (SAM)

Coder targets:
- **Privacy-constrained enterprises**: financial services, healthcare, defence, legal tech — estimated 30–40% of large engineering orgs with active AI-tool restrictions
- **Platform engineering teams**: internal developer platform investment is growing; IDP budgets at mid-to-large orgs typically run $500K–$5M/year
- **Domain expert communities**: open-source library maintainers, framework teams, and specialised agencies who want to encode and distribute their knowledge

Conservative SAM estimate: 50,000–200,000 platform engineers and technical leads in English-speaking markets.

### Serviceable Obtainable Market (SOM)

Year 1 target: 500–2,000 active installations (open source + early enterprise).
Year 2 target: 5,000–20,000, driven by marketplace network effects and IDE extension.

---

## Why Now

Three forces converge in 2025–2026:

1. **MLX maturation**: Apple's MLX framework reached production quality in late 2024. 7B parameter models run at 20–30 tok/s on M3 hardware that engineers already own. Local inference is no longer a research exercise.
2. **Enterprise AI governance pressure**: The EU AI Act and US executive orders on AI in regulated industries have accelerated internal policy formation. Privacy-first tooling has a policy tailwind.
3. **LoRA accessibility**: LoRA fine-tuning at rank 8 on 7B models requires no GPU cluster — just an M3 MacBook Pro and 30–60 minutes. The training cost barrier has collapsed.
