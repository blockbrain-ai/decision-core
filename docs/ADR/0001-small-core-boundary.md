# ADR 0001: Small Core Boundary

**Status:** Accepted
**Date:** 2026-05-04
**Authors:** Programme planning session

## Context

BOS has ~18,800 lines (actual `wc -l`) of decision/policy/trust/routing code across `src/policy`, `src/services/trust`, `src/services/route-optimization`, `src/contracts`, and related modules. The extraction feasibility report argues this subsystem is modular enough to extract.

However, extracting all of it produces a platform, not a focused governor. The programme plan establishes a **small-core rule**: the first deliverable must answer one question reliably — "given this tenant, policy version, surface, tool/action, context, and evidence, should this proceed, block, or require approval, and why?" If a feature does not improve that core decision contract or the proof trail, it is deferred.

## Decision

### Core package (`@blockbrainlabs/decision-core`)

These components ship in the core package and must work with zero external dependencies:

| Component | Source | Rationale |
|-----------|--------|-----------|
| Contracts (Zod schemas) | Adapted from BOS `src/contracts/` | Type foundation for all other components |
| Policy engine (PDP/PEP) | Extracted from BOS `src/policy/` | Safety-critical: deny-wins arbitration, staged enforcement |
| Deterministic routing | Extracted from BOS `src/services/route-optimization/` (generic framework only) | Enables offline operation; hard blockers are safety-critical |
| Evidence recording | Extracted from BOS + new | Audit trail, tamper detection, replayability |
| Persistence interfaces | New | Pluggable storage; in-memory default ships with core |
| In-memory persistence | New | Zero-config default for development and personal agents |
| Utils (uuid-v7, audit-hash) | Extracted from BOS `src/utils/` | Correlation IDs and tamper detection |
| Adapter interfaces | New | ModelGatewayAdapter, EventService — contracts only, no implementations |

### Optional modules (separate subpaths or packages)

These are valuable but not required for the core decision contract:

| Component | Source | Why optional |
|-----------|--------|-------------|
| Trust framework (tribunal, reviewer, a5_hybrid) | Extracted from BOS `src/services/trust/` | Requires ModelGatewayAdapter (LLM). Core works without models. |
| Clause graph + compiler | New (from policy-KB plan) | Adds policy-as-data and compiled rules. Core works with manually defined policy rules. |
| G-Brain adapter | New | Memory integration. Core stores decisions in its own persistence layer. |
| SQLite persistence | New | Production single-tenant. In-memory covers dev/testing. |
| Postgres persistence | Roadmapped (v0.2) | Not in v0.1 — memory (default) + SQLite are the shipped tiers. |
| MCP server | New | Surface layer. Core is the SDK. |
| HTTP API | New | Cross-language bridge (Hermes Python plugin). Core is TypeScript SDK. |
| CLI | New | Convenience. Core is programmatic. |
| Hermes plugin | New | Agent-specific adapter. |
| OpenCLAW plugin | New | Agent-specific adapter. |
| Policy packs | New | Starter configurations. Core works with empty policy. |
| Onboarding/audit skills | New | Agent-guided UX. Core works without. |

### Boundary rule

If the MVP production code grows past ~18K lines before the adapters work end-to-end, stop and evaluate whether optional modules should be split into separate packages.

## Consequences

- Phase 1 extraction copies only `core`-classified files from the extraction manifest.
- Optional modules are built in Phases 2-7.
- The trust framework ships in Phase 1 (it's too valuable to defer) but connects to the ModelGatewayAdapter interface — model-dependent patterns fail closed when no adapter is provided.
- The clause graph is Phase 2 — significant new code, not extraction.
- Agent adapters are Phase 4 — they depend on stable SDK contracts from Phase 3.
- Users can install `@blockbrainlabs/decision-core` and get a working policy governor with zero config. Additional features are opt-in.
