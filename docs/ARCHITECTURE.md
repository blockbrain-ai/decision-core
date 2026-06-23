# Architecture

Decision Core is a policy decision engine that evaluates, routes, and audits agent actions. It enforces governance rules with deny-wins arbitration, deterministic-first routing, and tamper-evident evidence chains.

## Component Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Surface Layer                                │
│   SDK  │  MCP Server  │  HTTP API  │  CLI                          │
├─────────────────────────────────────────────────────────────────────┤
│                       Decision Runner                               │
│   Quality Gate → Policy (PDP) → Trust Routing → Execution          │
├─────────────────────────────────────────────────────────────────────┤
│  Policy Engine    │  Trust Framework   │  Routing System            │
│  PDP / PEP       │  Surface Resolver  │  Route Resolver            │
│  Deny-Wins       │  Decision Patterns │  Deterministic Extractor   │
│  Autonomy Levels │  Tribunal          │  Evidence Bridge           │
├─────────────────────────────────────────────────────────────────────┤
│  Knowledge System (Clause Graph, Compiler, Enforcement)             │
├─────────────────────────────────────────────────────────────────────┤
│  Integrity Layer (Evidence Chains, Hash Linking, Replay)            │
├─────────────────────────────────────────────────────────────────────┤
│  Persistence Layer (Memory / SQLite)  │  Adapters (Events, Model)  │
└─────────────────────────────────────────────────────────────────────┘
```

## Core Components

### Surface Layer (`src/surfaces/`)

Entry points for external consumers. Each surface is a thin adapter that translates protocol-specific requests into the internal `evaluate()` call.

| Surface | Protocol | Use Case |
|---------|----------|----------|
| SDK | TypeScript import | Embedded in host application |
| MCP | Model Context Protocol | IDE and agent tool integration |
| HTTP | REST/JSON | Language-agnostic API access |
| CLI | Command line | Operator tooling and scripting |

All surfaces converge on the same Decision Runner pipeline, ensuring identical policy enforcement regardless of entry point.

### Decision Runner (`src/decisions/`)

Orchestrates the full evaluation pipeline:

```
Request
  │
  ▼
Quality Gate Check ──── fail ──→ blocked
  │
  ▼
Policy Evaluation (PDP) ──── deny ──→ blocked
  │                     └─── approve_required ──→ approval_required
  ▼
Trust Routing Resolution ──── determines pattern
  │
  ▼
Route Execution
  ├── Deterministic path (high confidence) ──→ skip model
  └── Model-assisted path ──→ call model gateway
  │
  ▼
Evidence Recording ──── hash-linked chain
  │
  ▼
Decision Logging ──── persist result
  │
  ▼
Result: completed | blocked | approval_required | safe_block | failed
```

**Outputs:** `DecisionRunnerResult` containing verdict, output, explanation, timing breakdown, evidence chain summary, and clause evidence.

### Policy Engine (`src/policy/`)

Implements deny-wins arbitration with autonomy levels.

- **Policy Decision Point (PDP):** Evaluates all applicable rules against the action context. Rules are matched by `actionType` using glob patterns. Results are arbitrated with strict precedence: `deny > approve_required > allow`.
- **Policy Enforcement Point (PEP):** Applies autonomy mode logic on top of PDP verdicts. Modes: strict (blocks on deny and approve_required), permissive (blocks on deny only), advisory (logs only).
- **Autonomy Levels 0-5:** Map to enforcement modes. Level 0-1 = strict, 2-3 = permissive, 4-5 = advisory.

See [Policy Authoring Guide](./POLICY-AUTHORING-GUIDE.md) for rule writing details.

### Trust Framework (`src/trust/`)

Maps surfaces to decision patterns based on risk tier and review requirements.

- **Surface Resolver:** Looks up the surface binding and dispatches to the appropriate decision pattern. Unknown surfaces default to `safe_block`.
- **Decision Patterns:** `single_model`, `primary_reviewer`, `tribunal`, `a5_hybrid`.
- **Tribunal:** Multi-assessor voting with arbiter resolution on disagreement.
- **Fallback Strategies:** `safe_block` (deny on failure), `downgrade_pattern`, `accept_primary`.

See [Trust Routing Guide](./TRUST-ROUTING-GUIDE.md) for configuration details.

### Routing System (`src/routing/`)

Deterministic route resolution with evidence bridge.

- **Runtime Route Resolver:** Loads route configuration and resolves surfaces to route classes. Deterministic candidates are evaluated for confidence; high-confidence candidates skip the model call entirely.
- **Route Classes:** `deterministic_only`, `deterministic_first_a5_on_uncertain`, `not_ready_data_or_policy_gap`, `frontier_or_human_required`.
- **Hard Blockers:** Constraints that prevent execution regardless of policy verdict.
- **Evidence Bridge:** Translates deterministic decision outputs into evidence records for the audit chain.

### Knowledge System (`src/knowledge/`)

Manages policy clauses as a versioned graph.

- **Ingestion Pipeline:** Import → Parse → Extract → Normalize → Detect Changes.
- **Clause Graph:** Nodes (clauses) connected by 16 edge types (depends_on, conflicts_with, supersedes, etc.).
- **Compiler:** Transforms clauses into executable rule sets with version tracking.
- **Enforcement Guard:** Evaluates compiled rule sets deterministically against action context.

See [Clause Schema Reference](./CLAUSE-SCHEMA-REFERENCE.md) for clause type details.

### Integrity Layer (`src/integrity/`)

Hash-linked evidence chains for tamper detection.

- **Evidence Recorder:** Appends operation records with SHA-256 hash linking.
- **Chain Verification:** Validates chain integrity; reports broken links.
- **Clause Version Chains:** Tracks policy content changes with content hashes.
- **Historical Replay:** Reconstructs decisions at any point in time using policy snapshots.

See [Evidence Chain Guide](./EVIDENCE-CHAIN-GUIDE.md) for chain structure details.

### Persistence Layer (`src/persistence/`)

Repository interfaces with pluggable implementations.

| Repository | Purpose |
|-----------|---------|
| PolicyRuleRepository | Policy rules CRUD |
| DecisionLogRepository | Decision audit log |
| ApprovalRepository | Approval workflow state |
| ClauseRepository | Clause storage |
| GraphEdgeRepository | Graph relationships |
| CompiledRuleSetRepository | Compiled rule sets |

**Implementations:**
- `memory/` — In-memory (default, zero dependencies)
- `sqlite/` — SQLite (persistent, single-file)

All repositories enforce tenant scoping (tenantId as first parameter).

### Adapters (`src/adapters/`)

Pluggable integrations with external systems.

- **EventService:** Domain event emission (default: no-op).
- **ModelGatewayAdapter:** LLM calls for model-assisted routing.

Both are optional — Decision Core runs fully without external dependencies.

## Configuration Hierarchy

Configuration is resolved with increasing specificity:

```
Defaults (hardcoded)
  └── Policy Pack (YAML file)
       └── Trust Suite (JSON config)
            └── Runtime overrides (environment / QuickStart options)
```

- **Policy Packs** (`config/packs/`): Pre-built rule sets for common profiles (personal, team, fintech, healthcare, saas).
- **Trust Suite** (`config/trust-suite/`): Surface bindings, risk tiers, review modes.
- **Runtime:** Environment variables and QuickStart options.

## Data Flow

A typical evaluation request flows through:

1. **Surface** receives request (surfaceId + action + context)
2. **Decision Runner** coordinates the pipeline
3. **PDP** evaluates rules → verdict (allow/deny/approve_required)
4. **Surface Resolver** determines routing pattern
5. **Route Resolver** checks for deterministic candidate
6. **Execution** runs deterministic logic or model call
7. **Evidence Recorder** appends hash-linked records at each step
8. **Decision Log** persists the final result
9. **Surface** returns structured result to caller

## Extension Points

| Extension | Mechanism | Example |
|-----------|-----------|---------|
| New surface | Implement surface adapter | WebSocket surface |
| Custom persistence | Implement repository interface | PostgreSQL backend |
| Policy pack | YAML file in config/packs/ | Industry-specific rules |
| Decision pattern | Implement pattern executor | Custom voting logic |
| Event handler | Subscribe to EventService | Slack notifications |
| Model provider | Implement ModelGatewayAdapter | OpenAI, Anthropic, local |

## Design Principles

1. **Deny-wins:** A single deny rule overrides any number of allow rules.
2. **Fail-closed:** Unknown surfaces and unavailable models result in safe_block, never allow.
3. **Deterministic-first:** Skip model calls when deterministic evaluation has high confidence.
4. **Zero mandatory dependencies:** Core runs with in-memory persistence and no network.
5. **Tenant isolation:** Every operation scoped by tenantId; no cross-tenant data access.
6. **Tamper evidence:** Every decision produces a hash-linked audit chain.

## Related Documentation

- [Providers](./PROVIDERS.md) — Provider modes and credential flow
- [Policy Authoring Guide](./POLICY-AUTHORING-GUIDE.md) — Writing rules
- [Clause Schema Reference](./CLAUSE-SCHEMA-REFERENCE.md) — 12 clause types
- [Trust Routing Guide](./TRUST-ROUTING-GUIDE.md) — Routing configuration
- [Evidence Chain Guide](./EVIDENCE-CHAIN-GUIDE.md) — Audit chain structure
- [Security](./SECURITY.md) — Threat model
- [Multi-Tenancy](./MULTI-TENANCY.md) — Tenant isolation
- [Integration Guides](./INTEGRATION-GUIDES/) — Adapter setup
