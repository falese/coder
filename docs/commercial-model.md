# Coder — Commercial Model Options

> Version 1.0 — 2026-03-23
> Audience: investors, founders, engineering leadership considering internal adoption

---

## Context

Coder is currently open source. The technical foundation (local inference, adaptor lifecycle, eval harness) is complete. This document analyses three viable commercial paths and makes a recommendation on sequencing.

The open questions from the product brief:
- **Primary monetisation path** — tooling SaaS, marketplace rev share, or enterprise license?
- **Adaptor marketplace model** — open community or enterprise-only?
- **IDE extension vs CLI-first** — which drives initial adoption?
- **Hosted registry timeline** — when does the registry become P0?

---

## Option A: Open Core + Enterprise License

### Model
- Core CLI, training toolchain, and community adaptor registry are free and open source
- Enterprise features require a commercial license:
  - Team adaptor management (version pinning, promotion workflows)
  - SSO + RBAC
  - Audit logging
  - Air-gapped registry deployment
  - SLA-backed support

### Pricing
- **Open source**: free, self-serve, community support
- **Team tier**: $49/user/month — shared adaptor library, 5-user minimum
- **Enterprise**: custom — air-gapped, SSO, audit, dedicated support

### Pros
- Open core creates organic distribution: engineers adopt the free tool, introduce it at work, trigger enterprise procurement
- Established model with strong precedents (HashiCorp, GitLab, Elastic)
- Privacy story is amplified by open source: customers can audit the code
- No per-query cost to manage — engineers are comfortable with per-seat SaaS

### Cons
- Enterprise sales cycles are long (3–9 months)
- Requires a self-hosted enterprise packaging and distribution story from day one
- Revenue does not materialise until v3 (team management features)

### Fit
Strong long-term model. Requires patience in the early phase. Best suited if the goal is a defensible, category-defining business over 3–5 years.

---

## Option B: Marketplace Revenue Share

### Model
- Platform and CLI are free and open source
- Adaptor marketplace charges a listing fee or revenue share for paid adaptor packs
- Community adaptors are free; enterprise-grade adaptors (with quality SLAs, ongoing updates, support) are paid

### Pricing (illustrative)
- **Community adaptors**: free listing, free installation
- **Premium adaptors**: adaptor authors set price ($X/team/month); Coder takes 20–30% revenue share
- **Verified publisher programme**: $99/year for quality badge + analytics dashboard

### Pros
- Aligns incentives: Coder earns when the ecosystem grows
- Network effects: more adaptors attract more engineers; more engineers incentivise more adaptor authors
- Lower barrier to initial adoption than enterprise licensing
- Revenue scales with ecosystem, not with headcount

### Cons
- Revenue is zero until marketplace has enough paid adaptors and active users (likely 12–18 months)
- Depends on community participation — requires investment in developer relations, documentation, and tooling
- Hard to predict revenue trajectory; lumpier than per-seat SaaS

### Fit
High potential ceiling. High execution risk in the short term. Best combined with Option A rather than as a standalone model.

---

## Option C: Tooling SaaS (Managed Hosting)

### Model
- Coder hosts a managed version of the adaptor registry and eval infrastructure
- Teams pay for managed training jobs (GPU-backed, faster than local M3 training)
- Managed eval runs as a service: submit a pull request, get a composite quality score back in CI

### Pricing
- **Registry hosting**: $29/team/month — hosted registry with private adaptor storage
- **Managed training**: pay-per-run, e.g., $5–15 per training job (offloads the 30–60 min local cost)
- **CI eval service**: $0.10–0.50 per eval run in CI

### Pros
- Recurring revenue from day one (registry hosting)
- Managed training appeals to teams that don't want to tie up an M3 for an hour
- CI integration creates sticky, high-frequency usage (multiple eval runs per PR)
- No enterprise sales cycle required for lower tiers

### Cons
- Hosting adaptor packs (even private ones) reintroduces a cloud dependency — weakens the core privacy narrative
- Managed training on cloud GPUs contradicts the "runs on your MacBook" positioning
- Operationally complex: requires GPU infrastructure, billing, uptime guarantees

### Fit
Most immediately monetisable, but the hardest to reconcile with the privacy-first value proposition. Position carefully: the *inference* is always local; only the *training* workload is optionally offloaded.

---

## Recommended Sequencing

The three options are not mutually exclusive. A phased approach captures each revenue stream as the product matures:

### Phase 1 (v1–v2, now through Q4 2026): Open source traction
- Keep everything free and open source
- Invest in community: documentation, adaptor authoring guide, Discord/GitHub presence
- Build the hosted registry (v2) as free infrastructure to grow the adaptor catalogue
- Goal: 2,000+ active CLI installs, 10+ community adaptor packs

### Phase 2 (v2–v3, Q4 2026–Q2 2027): Registry monetisation + SaaS entry
- Launch **Option C (Registry hosting)** — $29/team/month for private adaptor storage
- Launch **Option B (Marketplace rev share)** for premium adaptor listings
- Goal: $10K–$50K ARR from early adopters; proof of willingness to pay

### Phase 3 (v3+, Q2 2027+): Enterprise tier
- Launch **Option A (Enterprise license)** with team management, SSO, audit log
- Target platform engineering teams at mid-market and enterprise companies
- Goal: 5–10 enterprise contracts at $50K–$200K ARR each

---

## IDE Extension vs CLI-First

**Recommendation: CLI-first through v2, IDE extension as v2 launch anchor.**

The CLI is the right initial surface for two reasons:
1. Engineers who choose local AI tooling are generally power users comfortable with the terminal
2. A CLI is dramatically faster to iterate on than an IDE extension (no extension API surface, no marketplace review cycles)

The VS Code extension in v2 serves a different purpose: it is the **adoption wedge for non-power-users**. An engineering manager who would never run `coder generate` in a terminal will use it from a keyboard shortcut inside their editor. The extension dramatically expands the addressable audience.

---

## Hosted Registry Timeline

**The hosted registry (issue #16) should become P0 in v2.**

The registry is the prerequisite for everything else:
- Without it, adaptor distribution is manual (git URL required)
- Without it, marketplace monetisation cannot start
- Without it, the network effect between adaptor authors and users cannot compound
- Without it, enterprise teams have no central catalogue to manage

The git-based distribution in v1 is a functional proof of concept, not a distribution mechanism. Priority the registry as the first v2 deliverable.
