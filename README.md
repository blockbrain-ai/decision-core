# Decision Core

> The deterministic safety layer for AI agents — govern what your agent can do, with a tamper-evident audit trail.

Your AI agent can delete data, move money, deploy, or leak secrets — and most setups have **no brakes and no record**. Decision Core sits between your agent and its tools and enforces policy **before** an action runs, in a deterministic envelope around the agent's judgment.

**Adopt it without breaking anything:** install in **observe mode** to watch and record what it _would_ have blocked — blocking nothing — then review the impact and turn enforcement on with one command. No database, no LLM, no network required. Works in-process, as an MCP server, over HTTP, or via CLI.

```typescript
import { evaluate } from '@decision-core/core';

// deny-unknown ON: any action without a matching allow rule is denied.
const result = await evaluate(
  { action: 'delete_file', surface: 'api' },
  { denyUnknownDefault: true },
);
console.log(result.decision); // → 'deny'  (no allow rule matched → denied)
```

> **Default posture:** with no policy loaded and `denyUnknownDefault` unset, an unmatched
> action is **allowed** — deny-unknown is opt-in (shown above) or set by a policy pack.
> Load a pack (or enable deny-unknown) before relying on deny-wins enforcement.

> **What's proven vs experimental:** see [`docs/STATUS-LEDGER.md`](./docs/STATUS-LEDGER.md) — the canonical,
> evidence-backed status of every surface, capability, and integration. It wins over any other doc.

For the full pipeline with `quickStart`:

```typescript
import { quickStart, ActionApprovalDecision } from '@decision-core/core';

const dc = await quickStart({
  tools: ['read_*', 'write_*', 'search_*'],
});

const result = await dc.evaluate(new ActionApprovalDecision('delete_file')
  .withInputProvider(() => ({
    actionName: 'delete_file',
    actionParams: { path: '/data/report.csv' },
    requestedBy: 'agent-1',
    riskIndicators: ['destructive'],
  })),
);

console.log(result.verdict);
// → 'blocked'
// delete_file was denied — no matching allow rule, deny-unknown applied
```

## Features

- **Deny-wins policy engine** — if any rule says deny, the action is denied. No ambiguity.
- **Policy packs** — pre-built YAML rule sets for personal, team, fintech, healthcare, and SaaS use cases.
- **Trust routing** — map surfaces to decision patterns (deterministic, model-assisted, or hybrid).
- **Evidence chains** — hash-linked, tamper-evident audit records on every decision (SHA-256).
- **Approval workflows** — escalate risky actions to human review instead of auto-denying.
- **Autonomy levels** — five levels from strict (everything blocks) to advisory (everything logs).
- **Agent adapters** — pluggable event service, model gateway, and persistence interfaces.
- **Zero mandatory dependencies** — runs entirely in-memory with no database, no LLM, no network.

## Onboarding: install without breaking anything (watch-first)

Dropping a policy engine in front of an agent that already has tools is scary — what if it
blocks something it shouldn't? Decision Core's onboarding is **observe-first**: it watches and
records what it *would* have blocked, but blocks nothing, until you decide to turn enforcement on.

```bash
# 1. Set up — detects your tools, asks you to decide the dangerous powers, installs in OBSERVE mode.
decision-core setup           # (or your agent runs the dc_setup_* / dc_onboard_* MCP tools)

# 2. Use your agent normally. Decision Core watches, does not block.

# 3. See exactly what enforcement WOULD have blocked (redacted — no tool arguments).
decision-core observations --recommend

# 4. Happy with it? Turn on real blocking (one command — backs up + validates the config).
decision-core enforce
```

- **Executive decisions:** at setup you make an explicit `allow / ask / block` call on the dangerous
  capability classes (delete data, move money, deploy, contact externally, credentials). Safe defaults
  are pre-selected; your choices become top-priority rules.
- **Agent-maintained:** the same flow is available to your agent over MCP (`dc_setup_detect`,
  `dc_observations`, `dc_enforce`, …), so the agent can onboard and review on your behalf — you just
  approve. (Policy-mutating MCP tools are off by default; enable explicitly.)
- **Always visible:** `decision-core doctor` always tells you whether you're observing or enforcing.

## Quick Start: Personal (5 minutes)

Install and evaluate your first decision.

### 1. Install

```bash
npm install @decision-core/core
```

### 2. Set up Decision Core

```typescript
import { quickStart } from '@decision-core/core';

// Declare which tools your agent can use.
// Anything not listed is denied by default (deny-unknown).
const dc = await quickStart({
  tools: ['read_*', 'write_*', 'search_*', 'list_*'],
  profile: 'personal',
});
```

### 3. Evaluate a decision

Decision Core uses the `BaseDecision` interface for structured evaluation. The built-in `ActionApprovalDecision` template handles tool approval. Pass the action name to the constructor — that is what your policy rules (e.g. the `tools` patterns above) match against:

```typescript
import { ActionApprovalDecision } from '@decision-core/core';

// An allowed action
const readDecision = new ActionApprovalDecision('read_file')
  .withInputProvider(() => ({
    actionName: 'read_file',
    actionParams: { path: '/docs/readme.md' },
    requestedBy: 'agent-1',
    riskIndicators: [],
  }));

const allowed = await dc.evaluate(readDecision);
console.log(allowed.verdict); // → 'completed'

// A blocked action
const deleteDecision = new ActionApprovalDecision('delete_file')
  .withInputProvider(() => ({
    actionName: 'delete_file',
    actionParams: { path: '/data/important.csv' },
    requestedBy: 'agent-1',
    riskIndicators: ['destructive'],
  }));

const blocked = await dc.evaluate(deleteDecision);
console.log(blocked.verdict); // → 'blocked'
```

> **Note — two evaluate APIs, two verdict vocabularies.** The lightweight
> top-level `evaluate({ action, surface })` returns a *policy* decision:
> `'allow' | 'deny' | 'approve_required'`. The full pipeline
> `dc.evaluate(decision)` returns a *decision run* verdict:
> `'completed' | 'blocked' | 'approve_required'` (a completed run means the
> action was allowed). Use the top-level `evaluate()` for simple gate checks
> and `dc.evaluate()` when you want evidence chains, explanations, and replay.

### 4. Explain a decision

```typescript
const explanation = await dc.explain(blocked.correlationId);
console.log(explanation.summary);
// → "Decision denied by policy rule(s): deny-unknown-tools."
console.log(explanation.evidenceSummary);
// → "3 evidence record(s) in chain; total latency: 2ms; head hash: a1b2c3d4e5f6..."
```

## Quick Start: Team (30 minutes)

Configure Decision Core for a team with custom rules, surfaces, and approval workflows.

### 1. Choose a policy pack

Policy packs are YAML files that define rules, surfaces, and trust tiers. Start with a built-in pack and customize:

```typescript
import { fromPolicyPack } from '@decision-core/core';

// Built-in packs: 'personal', 'team', 'fintech', 'healthcare', 'saas'
const dc = await fromPolicyPack('team');
```

The `team` pack allows read/write operations, requires approval for destructive operations (`delete_*`, `drop_*`), and blocks admin actions.

### 2. Write custom rules

Create a YAML policy pack at `config/policy-pack.yaml`:

```yaml
name: my-team-policy
version: 1.0.0
description: Custom team policy with deployment controls
profile: team

rules:
  - name: allow-read-tools
    description: Allow all read operations
    action: allow
    tools: ["read_*", "search_*", "list_*", "get_*"]
    priority: 10

  - name: allow-write-tools
    description: Allow write and create operations
    action: allow
    tools: ["write_*", "create_*", "update_*"]
    priority: 5

  - name: approve-deployments
    description: Deployment actions require human approval
    action: approve_required
    tools: ["deploy_*", "release_*"]
    priority: 90

  - name: block-destructive
    description: Block destructive operations
    action: deny
    tools: ["delete_*", "drop_*", "rm_*", "destroy_*"]
    priority: 100

  - name: block-admin
    description: Block admin and privilege escalation
    action: deny
    tools: ["admin_*", "sudo_*", "escalate_*"]
    priority: 100

surfaces:
  - name: ci-pipeline
    trustTier: elevated
    category: automation

  - name: dev-workspace
    trustTier: standard
    category: workspace

trustTiers:
  - name: standard
    requiresApproval: false
    requiresAudit: false
    riskLevel: low

  - name: elevated
    requiresApproval: true
    requiresAudit: true
    riskLevel: medium
```

### 3. Load your custom pack

```typescript
import { quickStart, loadPolicyPack } from '@decision-core/core';

const dc = await quickStart({
  profile: 'team',
  tools: ['read_*', 'write_*', 'deploy_*'],
});

// Or load from a YAML file path using createDecisionCore:
import { createDecisionCore } from '@decision-core/core';

const dcFull = await createDecisionCore({
  policyPackPath: './config/policy-pack.yaml',
  tenantId: 'my-team',
});
```

### 4. Use the policy guard for lightweight checks

If you only need allow/deny/approve_required verdicts without the full decision pipeline:

```typescript
import { createPolicyGuard } from '@decision-core/core';

const guard = await createPolicyGuard({
  policyPackPath: './config/policy-pack.yaml',
  tenantId: 'my-team',
});

const verdict = await guard.evaluate('my-team', 'ci-pipeline', 'deploy_staging');
console.log(verdict.verdict); // → 'approve_required'
console.log(verdict.matchedPolicies[0].reason);
// → "Rule 'approve-deployments' matched action 'deploy_staging'"
```

## Quick Start: Enterprise (1–2 days)

Full setup with trust tiers, provider configuration, SQLite persistence, and audit compliance.

### 1. Configure persistence

Switch from in-memory to SQLite for durable decision logs and evidence chains.
SQLite uses the optional native dependency `better-sqlite3` — install it first:

```bash
npm install better-sqlite3
```

```typescript
import { quickStart } from '@decision-core/core';

const dc = await quickStart({
  profile: 'enterprise',
  tools: ['read_*', 'write_*', 'approve_*'],
  storage: 'sqlite',
  sqlitePath: './data/decisions.db',
});
```

Or use the full configuration API:

```typescript
import { createDecisionCore } from '@decision-core/core';

const dc = await createDecisionCore({
  persistence: 'sqlite',
  tenantMode: 'multi',
  tenantId: 'acme-corp',
  policyPackPath: './config/packs/fintech.yaml',
  trustConfig: {
    policyPath: './config/trust-suite/trust-policy.json',
    bindingsPath: './config/trust-suite/surface-bindings.json',
    registryPath: './config/trust-suite/surface-registry.json',
  },
  provider: {
    mode: 'host',
    hostCallback: async (prompt, options) => {
      // Wire to your LLM provider for model-assisted decisions
      const response = await yourLlmClient.complete(prompt, options);
      return {
        text: response.text,
        model: response.model,
        confidence: response.confidence,
        latency: response.latencyMs,
      };
    },
  },
});
```

### 2. Use industry policy packs

Decision Core ships with enterprise-grade policy packs:

| Pack | Profile | Use Case |
|------|---------|----------|
| `personal` | personal | Individual agent — permissive reads, blocks destructive |
| `team` | team | Shared agent — destructive ops need approval |
| `fintech` | enterprise | Financial services — strict financial constraints, regulatory compliance |
| `healthcare` | enterprise | Health-tech — patient data sensitivity, HIPAA-inspired rules |
| `saas` | enterprise | Multi-tenant SaaS — isolation checks, API rate limiting |

```typescript
import { fromPolicyPack } from '@decision-core/core';

const dc = await fromPolicyPack('fintech', {
  tenantId: 'trading-desk-1',
});
```

### 3. Configure trust tiers

Trust tiers control how surfaces (API endpoints, agent channels, CI pipelines) are evaluated. Configure them in `config/trust-suite/trust-policy.json`:

```json
{
  "surfaces": {
    "api.public": {
      "surfaceId": "api.public",
      "riskTier": "high",
      "requiresApproval": true,
      "requiresAudit": true,
      "modelPolicy": {
        "allowedProviders": ["anthropic", "openai"],
        "maxCost": 0.50,
        "requiredSafety": ["content_filter"]
      }
    },
    "internal.batch": {
      "surfaceId": "internal.batch",
      "riskTier": "low",
      "requiresApproval": false,
      "requiresAudit": true
    }
  }
}
```

### 4. Verify evidence chains

Every decision creates a hash-linked evidence chain. The result includes chain metadata for audit compliance:

```typescript
const result = await dc.evaluate(decision);

// Every result carries evidence chain metadata
console.log(result.evidenceChain.recordCount); // → 5
console.log(result.evidenceChain.headHash);    // → 'a1b2c3d4...' (SHA-256)
console.log(result.auditHash);                 // → SHA-256 of decision payload
console.log(result.correlationId);             // → trace ID linking all evidence records

// Each evidence record's auditHash = SHA-256(sequence || previousHash || payload || operationType)
// Tampering with any record breaks the chain — detectable via EvidenceChainService.verify()
```

### 5. Use the CLI

Decision Core includes a CLI for policy evaluation, explanation, and auditing:

```bash
# Onboard (observe-first), review impact, then promote to enforcement
decision-core setup
decision-core observations --recommend
decision-core enforce

# Health + current mode (observe vs enforce)
decision-core doctor

# Evaluate an action against policies
decision-core evaluate --surface api.public --action delete_user

# Explain a past decision
decision-core explain --id <correlation-id>

# Ingest a policy document (a single Markdown file; positional path or --file)
decision-core ingest ./policies/my-policy.md

# Compile policy rules
decision-core compile

# Validate a structured policy document
decision-core validate config/templates/structured-clause-low-risk.md

# Lint structured policy clauses against surface contracts
decision-core lint config/templates/structured-clause-low-risk.md

# Analyze a policy pack for conflicting rules
decision-core analyze config/packs/fintech.yaml

# Generate test cases from compiled rules
decision-core generate-tests --rule-set ./compiled-rules.json --output ./policy-tests.json

# Run a compliance audit
decision-core audit

# Start the MCP server
decision-core serve --mcp
```

Structured policy documents can use YAML frontmatter plus `decision-core-clause` blocks. Each block carries an explicit `RuleExpression`, surface, decision, and provenance line reference so rules can compile without prose regex inference:

````markdown
---
schema_version: "1.0.0"
policy_id: dc.example
surfaces: [finance.processing]
---

```decision-core-clause
clause_id: dc.example.amount
clause_type: threshold
condition:
  type: threshold
  field: amount
  operator: gte
  value: 10000
decision: approve_required
surface_id: finance.processing
route_class: deterministic_only
safe_to_execute_without_model: true
```
````

### 6. Connect via MCP

Decision Core runs as a Model Context Protocol server for IDE and agent integrations. Start it via the CLI:

```bash
decision-core serve --mcp
```

The MCP server exposes the core tools `evaluate`, `query_policy`, `list_policy_rules`,
`explain_decision`, `audit_trail`, `ingest_policy`, and `compile_rules`, plus
the bundled onboarding, setup, policy-author, and audit workflow tools. For
programmatic setup, use `createMcpServer(deps, config)` from
`@decision-core/core`.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Agent / Host                              │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │   SDK    │  │   MCP    │  │   CLI    │  │      HTTP        │ │
│  │quickStart│  │  server  │  │ commands │  │     routes       │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘ │
│       │              │             │                  │           │
│  ─────┼──────────────┼─────────────┼──────────────────┼────────  │
│       │         Surface Layer (public APIs)           │          │
│  ─────┼──────────────┼─────────────┼──────────────────┼────────  │
│       │              │             │                  │           │
│       └──────────────┴──────┬──────┴──────────────────┘           │
│                             │                                    │
│  ┌──────────────────────────┴──────────────────────────────────┐ │
│  │                    Decision Runner                          │ │
│  │  quality gates → policy eval → trust routing → execution   │ │
│  └──────┬──────────────┬──────────────┬──────────────┬────────┘ │
│         │              │              │              │           │
│  ┌──────┴─────┐ ┌──────┴─────┐ ┌─────┴──────┐ ┌────┴────────┐ │
│  │  Policy    │ │   Trust    │ │  Routing   │ │  Evidence   │ │
│  │  Engine    │ │  Framework │ │  Engine    │ │  Integrity  │ │
│  │            │ │            │ │            │ │             │ │
│  │ PDP (deny- │ │ surface    │ │ route      │ │ hash-linked │ │
│  │ wins)      │ │ resolver   │ │ resolver   │ │ chains      │ │
│  │ PEP        │ │ trust      │ │ optimizer  │ │ clause ver. │ │
│  │ autonomy   │ │ tiers      │ │ hard       │ │ historical  │ │
│  │ levels     │ │ bindings   │ │ blockers   │ │ replay      │ │
│  └──────┬─────┘ └──────┬─────┘ └─────┬──────┘ └────┬────────┘ │
│         │              │              │              │           │
│  ─ ─ ─ ┼ ─ ─ ─ ─ ─ ─ ┼ ─ ─ ─ ─ ─ ─ ┼ ─ ─ ─ ─ ─ ─ ┼ ─ ─ ─ ─ │
│         │        Persistence Layer (pluggable)       │          │
│  ─ ─ ─ ┼ ─ ─ ─ ─ ─ ─ ┼ ─ ─ ─ ─ ─ ─ ┼ ─ ─ ─ ─ ─ ─ ┼ ─ ─ ─ ─ │
│         │              │              │              │           │
│  ┌──────┴──────────────┴──────────────┴──────────────┴────────┐ │
│  │  In-Memory (default)  │  SQLite (optional)  │  Custom      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Adapters (optional, host-provided)                        │  │
│  │  EventService  │  ModelGateway  │  Hermes  │  OpenCLAW     │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

**Core** (zero dependencies, always available):
- **Policy Engine** — PDP with deny-wins arbitration, PEP with autonomy levels (0–5), glob-based rule matching
- **Trust Framework** — surface-to-tier mapping, decision pattern selection (deterministic / model-assisted / hybrid)
- **Routing Engine** — deterministic route extraction, scoring, hard blocker detection
- **Evidence Integrity** — SHA-256 hash-linked chains, clause versioning, historical replay

**Surface Layer** (choose one or many):
- **SDK** — `quickStart()`, `fromPolicyPack()`, `createDecisionCore()`, `createPolicyGuard()`
- **MCP** — Model Context Protocol server with core policy tools plus bundled onboarding, setup, authoring, and audit tools
- **CLI** — evaluate, explain, ingest, compile, audit, serve commands
- **HTTP** — REST API (shipped via `createHttpServer`)

**Persistence Layer** (pluggable):
- **In-Memory** — default, no setup, ideal for development and single-process agents
- **SQLite** — durable storage via optional `better-sqlite3` dependency
- **Custom** — implement `PolicyRuleRepository`, `DecisionLogRepository`, `EvidenceRepository`

**Adapters** (optional, host-provided):
- **EventService** — emit domain events to your observability stack (default: no-op)
- **ModelGateway** — wire to your LLM provider for model-assisted decisions
- **Hermes / OpenCLAW / G-Brain** — integration adapters for companion systems

## Comparison

| Feature | Decision Core | Guardrails AI | NeMo Guardrails | LangChain Guardrails |
|---|---|---|---|---|
| **Policy engine** | Deny-wins PDP/PEP with autonomy levels | Validator-based, no arbitration | Dialog-rail based | Output parser checks |
| **Policy-as-data** | YAML policy packs, hot-reloadable | Python validators | Colang scripts | Python code |
| **Approval workflows** | Built-in escalation to human review | Not built-in | Not built-in | Not built-in |
| **Evidence chains** | Hash-linked, tamper-evident (SHA-256) | Logging only | Logging only | Logging only |
| **Historical replay** | Replay decisions with point-in-time policies | No | No | No |
| **Trust routing** | Surface-to-tier mapping, deterministic/model/hybrid | No | No | No |
| **Clause versioning** | Hash-linked clause version chains | No | No | No |
| **Tenant isolation** | Tenant-scoped policy/data isolation via authenticated identity binding | No | No | No |
| **LLM requirement** | Optional — core is fully deterministic | Required for some validators | Required | Required for LLM checks |
| **Database requirement** | None — in-memory default, SQLite optional | Depends on validator | None | None |
| **MCP server** | Built-in | No | No | No |
| **Scope** | Decision governance + audit | Input/output validation | Conversation safety | Output validation |

**Decision Core is complementary to validation libraries.** Guardrails AI and NeMo Guardrails validate LLM inputs and outputs. Decision Core governs whether an action should proceed at all, with full audit trail and policy versioning. Use them together: Decision Core for governance, guardrails for content safety.

## Integration

Decision Core governs tool calls in your existing agent runtime:

- **Hermes** (recommended) — Python agent runtime. The plugin enforces policy in
  Hermes's `pre_tool_call` hook and records audit in `post_tool_call`, proven
  end-to-end through Hermes's real tool-dispatch path (`handle_function_call`).
  See [`test/hermes-dropin-e2e/`](./test/hermes-dropin-e2e/) and the
  [Hermes guide](./docs/INTEGRATION-GUIDES/hermes.md).
- **OpenClaw** (experimental) — TypeScript agent runtime. In-process hook
  plugin aligned with OpenClaw's real plugin API, but not yet verified through a
  full OpenClaw agent loop. Run behind `failMode: 'closed'`. See the
  [OpenClaw guide](./docs/INTEGRATION-GUIDES/openclaw.md).
- **G-Brain** (optional) — knowledge graph. An optional evidence sink for
  durable, tamper-evident off-box audit storage; Decision Core queries it for
  entity context during evaluation when configured.

All integrations are optional. Decision Core runs standalone with zero external
dependencies, and the HTTP server keeps a working in-memory audit trail
(`GET /audit`) out of the box.

## What Decision Core Does Not Do

- **Content filtering** — use Guardrails AI or NeMo Guardrails for input/output validation
- **Prompt engineering** — Decision Core evaluates whether to act, not how to prompt
- **Agent orchestration** — use Hermes or LangChain for multi-agent workflows
- **Secret management** — Decision Core checks credentials are not leaked, but does not store them

## API Reference

Full API documentation is available in [`docs/`](./docs/):

- [Integration Contracts](./docs/INTEGRATION-CONTRACTS.md) — adapter interfaces and event schemas
- [Policy Pack Reference](./config/packs/README.md) — YAML policy pack structure and examples

## Project Structure

```
src/
├── contracts/       Zod schemas — single source of truth for all shapes
├── policy/          Policy engine — PDP, PEP, autonomy levels, glob matching
├── trust/           Trust framework — surface resolver, tier mapping, decision patterns
├── routing/         Route resolution — deterministic extraction, scoring, hard blockers
├── decisions/       Decision runner — pipeline orchestrator, evidence recording
├── integrity/       Evidence chains — hash linking, clause versioning, historical replay
├── persistence/     Repository interfaces + in-memory defaults
├── surfaces/        Public APIs — SDK, MCP, CLI, HTTP
├── adapters/        Pluggable integrations — event service, model gateway
├── packs/           Policy pack loader
├── core/            Model gateway, provider policy, credential audit
├── knowledge/       Clause graph, deterministic enforcement
├── skills/          Agent-guided UX — onboarding, policy authoring, audit
└── utils/           Logger, UUID, audit hash
```

## Requirements

- Node.js >= 20.0.0
- TypeScript >= 5.7 (for development)
- No runtime dependencies beyond Zod, Pino, YAML, and MCP SDK

## Existing Hermes or G-Brain deployments

Decision Core does not require a clean-room install. If Hermes, OpenClaw, or
G-Brain already exist:

1. keep the existing host and memory store in place
2. run `decision-core setup --dry-run --json` first to inspect what Decision
   Core detects
3. add the Decision Core plugin or hook around the existing host
4. point Decision Core at the existing G-Brain instance for evidence write-back

For Hermes + G-Brain specifically:

- prefer the G-Brain HTTP transport over the CLI transport when G-Brain HTTP is
  already running against a PGLite-backed store
- keep Decision Core secrets in per-agent env files referenced from Hermes
  config with `${DC_API_KEY}` / `${DC_AGENT_ID}`
- keep search provider settings such as `brave-free` under Hermes web config,
  not under `terminal.backend`

For a full existing-deployment walkthrough, see the
[Hermes integration guide](./docs/INTEGRATION-GUIDES/hermes.md) and
[G-Brain evidence sink guide](./docs/INTEGRATION-GUIDES/gbrain.md).

## Organisation Mode (Multi-Agent)

For businesses running multiple AI agents with role-based access control.

Organisation mode is **opt-in**. Personal and team setups work exactly as before — no `agents.yaml`, no access policy, no per-agent tokens required.

### Quick Start: Organisation

```bash
# 1. Initialise org config files
decision-core org init --profile small-business

# 2. Review and customise
#    .decision-core/agents.yaml       — agent identities and roles
#    .decision-core/access-policy.yaml — information access matrix
#    .decision-core/policy-pack.yaml   — role-scoped policy rules

# 3. Provision per-agent tokens and configs
decision-core provision
#    writes .decision-core/agent-auth.yaml plus per-agent env files

# 4. Verify everything matches the access policy
decision-core provision --verify

# 5. Generate a status report
decision-core org report
```

### What Org Mode Adds

- **Token-bound agent identity** — each agent gets a unique bearer token; the server derives identity from the token, not from request bodies
- **Role-scoped policy rules** — `requiredRoles` on rules restricts which agents can use which tools
- **Access policy document** — a single YAML file defining which roles can access which information classifications
- **Per-agent provisioning** — generates env files, brain mount manifests, and auth bindings per agent
- **Approval routing** — `approve_required` verdicts route to specific roles with separation-of-duties enforcement
- **`denyUnknownDefault: true`** — unknown tools are blocked until classified

### What Org Mode Does NOT Change

- **Personal setup**: `decision-core setup --profile personal` works identically
- **SDK API**: `createPolicyGuard()` and `createDecisionCore()` work without an agent registry
- **HTTP server**: bearer token auth works without org mode; `--allow-unauthenticated-local` still available
- **MCP server**: no changes
- **Existing policy packs**: personal, team, fintech, healthcare, saas packs unchanged

See [Organisation Deployment Security](./docs/ORG-DEPLOYMENT-SECURITY.md) for the full threat model.

## Contributing

1. Clone the repository
2. Install dependencies: `npm install`
3. Run tests: `npm test`
4. Type check: `npm run typecheck`
5. Lint: `npm run lint`

Tests live next to source files (`foo.ts` → `foo.test.ts`). All repository methods take `tenantId` as the first parameter. Every evidence record carries `correlationId`, `timestamp`, `tenantId`, and `auditHash`. Use the structured logger (`createLogger`), never `console.log`.

## License

Apache-2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
