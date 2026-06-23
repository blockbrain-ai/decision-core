# Multi-Agent Organisation Deployment — Security Model

This document defines Decision Core's threat model, guarantees, and failure modes when deployed as the policy layer for a multi-agent organisation. It is the fixed security target for the org-mode implementation.

## Deployment Model

A small business (2–20 staff) where each role has a human operator and a supporting AI agent. The agents are powered by Hermes (or OpenClaw) and governed by Decision Core policy rules. Each agent has role-appropriate access to information via G-brain. The business is human-led: humans make decisions, agents support and execute within policy boundaries.

## What Decision Core Guarantees in Org Mode

| Guarantee | Mechanism |
|-----------|-----------|
| Every agent has a server-verified identity | Bearer token → auth binding → agentId. Body-level `agentId` is a consistency check, never the source of truth. |
| Every tool call is evaluated against the caller's role | `callerRoles` injected into PolicyContext from the agent registry after token-verified identity resolution. |
| Unknown tools are denied until classified | `denyUnknownDefault: true` is mandatory in org mode. New tools fail closed. |
| Deny-wins arbitration | If any applicable rule returns `deny`, the final verdict is `deny` regardless of other rules. |
| Separation of duties | An agent cannot approve its own `approve_required` request unless a break-glass policy explicitly permits it (requires CEO role, reason, expiry, and audit trail). |
| Approval routing by role | `approve_required` verdicts are routed to the `approverRole` defined on the triggering policy rule. |
| Evidence chain integrity | SHA-256 hash-linked audit trail with tamper detection for every decision. |
| Tenant-scoped persistence | Every repository query is scoped by `tenantId`. No cross-tenant data access. |

## What Decision Core Does NOT Guarantee

| Non-Guarantee | Why |
|---------------|-----|
| Runtime process isolation | Decision Core is a policy evaluation engine. It cannot prevent a process with filesystem access from reading files outside its authorised scope. Runtime containment (separate OS users, containers, workspace restrictions) is the deployer's responsibility. |
| Network-level security | TLS, firewalls, and network segmentation are infrastructure concerns. |
| G-brain database isolation | Decision Core does not manage G-brain credentials or database access. The deployer must ensure each agent's runtime only has credentials for its authorised brains. |
| Credential secrecy after provisioning | Decision Core provisions per-agent tokens and env files. Physical security of those files is the deployer's responsibility. |
| Model output correctness | Decision Core evaluates governance (can this agent do this?), not model quality (is the answer good?). |
| Exhaustive roll-up redaction | Command center roll-ups use redaction policies, but the deployer must verify that roll-up job prompts do not leak individual secrets. |

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│ UNTRUSTED: Agent request (HTTP body, MCP message, CLI input)    │
│   - agentId in body is NOT trusted                              │
│   - action, context, metadata are validated but not trusted     │
├─────────────────────────────────────────────────────────────────┤
│ AUTH BOUNDARY: Bearer token → auth binding → resolved agentId   │
│   - Token subject looked up in agent-auth store                 │
│   - Body agentId must match or request is denied + audited      │
│   - Resolved agentId used to load roles from agent registry     │
├─────────────────────────────────────────────────────────────────┤
│ POLICY BOUNDARY: PDP evaluates with resolved callerRoles        │
│   - Role-scoped rules checked (requiredRoles on PolicyRule)     │
│   - Deny-wins arbitration                                       │
│   - denyUnknownDefault blocks unclassified tools                │
├─────────────────────────────────────────────────────────────────┤
│ TRUSTED: Core engine (persistence, audit, evidence)             │
├─────────────────────────────────────────────────────────────────┤
│ ADAPTER BOUNDARY: G-brain, event services, external APIs        │
│   - Credentials never cross into core engine                    │
│   - Per-agent credential scoping is deployer's responsibility   │
└─────────────────────────────────────────────────────────────────┘
```

## Identity Model

### Token-Bound Identity (non-spoofable)

Each agent receives a unique bearer token at provisioning time. The Decision Core server stores only a salted hash or opaque key ID — never the raw token. On every request:

1. Extract bearer token from `Authorization` header.
2. Derive a non-secret `subject` from the token (e.g., hash prefix or key ID).
3. Look up `subject` in the agent-auth binding store → get `agentId` + `tenantId`.
4. If the request body also contains `agentId`, verify it matches the resolved identity. Mismatch → 403 + audit event.
5. Load `roles` from the agent registry for the resolved `agentId`.
6. Inject `agentId` and `callerRoles` into `PolicyContext`.

### Why Body-Level agentId Is Insufficient

A compromised or misconfigured agent could send `agentId: "ceo-agent"` in its request body and inherit CEO-level policy. The server must never trust `agentId` from the request body as the source of identity. It is accepted only as a consistency check.

### In-Process SDK Exception

When Decision Core is embedded via the SDK (e.g., OpenClaw in-process), the host application is trusted to provide correct `agentId`. The SDK resolves roles from the agent registry but does not require token validation — the trust boundary is the process boundary.

## Information Isolation Model

### Defence in Depth (three independent barriers)

1. **Brain-level database isolation (primary):** Each agent's runtime only has credentials and filesystem access for its personal brain and authorised shared brains. Unauthorised brain databases are unreachable.

2. **Decision Core policy rules (secondary):** Even if an agent could somehow reach an unauthorised brain, policy rules with `requiredRoles` deny the tool call.

3. **Runtime containment (tertiary):** Each agent runs with restricted filesystem, environment, and credential access. Two independent systems must fail before a leak is possible.

### Brain Topology

- **Personal brains** (one per staff agent, not per role): Private working memory. Two people with the same role get separate personal brains.
- **Classification-tiered shared brains:** `company-public` (all roles), `company-financial` (CEO + finance), `company-hr` (CEO only), etc.
- **Command center brain:** Aggregated cross-functional source of truth. CEO-only access. Receives redacted roll-up summaries, never raw private data.

### Access Policy Document

A single `.decision-core/access-policy.yaml` defines the complete role-to-classification access matrix. Both human-readable (CEO reviews) and machine-enforceable (provisioning reads it). `decision-core provision --verify` checks all brain mounts, credentials, and runtime paths against this document.

## Tool Drift Safety

When a new tool is added to Hermes or OpenClaw:

1. `denyUnknownDefault: true` blocks the tool immediately — no silent inheritance of broad access.
2. `decision-core provision --verify` reports the unclassified tool.
3. The owner reviews and either adds it to the tool inventory with a risk tier and allowed roles, or explicitly blocks it.
4. Only after the policy pack is updated does the tool become available.

## Roll-Up Redaction

Command center roll-ups flow information UP from role/personal brains. Constraints:

- Roll-ups use `redacted-aggregate-only` mode: explicit aggregates, metrics, exceptions, and provenance links.
- `forbiddenFields` in the access policy list data that must never appear in roll-ups (individual salaries, raw customer secrets, private staff notes).
- Roll-up jobs have their own classification rules and negative tests.
- Raw private content never flows to the command center.

## Separation of Duties

- An agent cannot approve its own `approve_required` request by default.
- Break-glass override requires: CEO role, explicit reason, expiry timestamp, and a dedicated audit event.
- `resolvedBy` must differ from `requestedBy` on approval resolution unless break-glass conditions are met.

## Fail-Closed Defaults in Org Mode

| Scenario | Behaviour |
|----------|-----------|
| No bearer token on HTTP request | 401 Unauthorized |
| Token not found in auth binding store | 403 Forbidden |
| Body agentId mismatches token identity | 403 Forbidden |
| Agent disabled in registry | 403 Forbidden |
| Staff token reads policy/audit endpoints without audit role | 403 Forbidden |
| Unknown tool (no matching policy rule) | Deny (denyUnknownDefault) |
| No agent registry loaded | All role-scoped rules skip (backward-compatible non-org mode) |
| Agent-auth store missing in org mode | Server refuses to start |
| Access policy violation detected by --verify | Exit code 1, violation report |

## Owner-Facing Setup Flow

### 1. Initialise

```bash
decision-core org init --profile small-business
```

Generates starter files:
- `.decision-core/agents.yaml` — agent identity registry
- `.decision-core/access-policy.yaml` — information access matrix
- `.decision-core/policy-pack.yaml` — role-scoped policy rules with `denyUnknownDefault: true`
- `.decision-core/tool-inventory.yaml` — classified tool list

### 2. Review and Edit

The owner reviews and customises:
- **agents.yaml**: agent IDs, display names, human owners, roles, personal brain IDs
- **access-policy.yaml**: which roles can access which information classifications
- **policy-pack.yaml**: tool-level rules with `requiredRoles` for role restriction

### 3. Provision

```bash
decision-core provision
```

Generates per-agent configuration:
- Per-agent `.env` fragment with unique bearer token
- Per-agent brain mount manifest
- Auth binding store (token hashes, never raw tokens)
- Tool inventory with risk tiers
- File permissions set to owner-only (0600) for env/token files

### 4. Start Agents

Owner starts one Hermes/OpenClaw instance per staff agent using only that agent's generated config:

```bash
# Each agent gets its own env, token, brain mounts, and workspace
source .decision-core/agents/finance-agent/agent.env
hermes --config finance-hermes.yaml
```

### 5. Verify

```bash
decision-core provision --verify
```

Checks:
- Policy pack has rules referencing each agent's roles
- Auth bindings exist for all enabled agents
- Brain mounts match access-policy.yaml classifications
- No credential refs outside the agent's allowed set
- No unknown/unclassified tools
- Runtime path exposure warnings (where detectable)
- Exit code 1 on any violation

### 6. Negative Tests

Before enabling real business credentials, run negative tests:
- Finance agent cannot read HR brain
- Product agent cannot approve purchases
- Operations agent cannot access command center
- Spoofed agentId in body is rejected
- New unclassified tool is blocked

### 7. Go Live

Only after verification and negative tests pass does the owner enable real business credentials and production data.

## Related Documentation

- [Security](./SECURITY.md) — Base security model (single-agent)
- [Multi-Tenancy](./MULTI-TENANCY.md) — Tenant isolation details
- [Evidence Chain Guide](./EVIDENCE-CHAIN-GUIDE.md) — Tamper detection
- [Architecture](./ARCHITECTURE.md) — System design overview
