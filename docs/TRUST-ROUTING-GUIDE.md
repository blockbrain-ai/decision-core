# Trust Routing Guide

Decision Core uses a deterministic-first routing strategy. Every action is first evaluated for deterministic resolution; model-assisted patterns are invoked only when deterministic evaluation cannot produce a high-confidence result.

## Trust Tiers

Surfaces are assigned risk tiers that determine review requirements:

| Tier | Risk Level | Review Mode | Typical Use |
|------|-----------|-------------|-------------|
| `low` | Low | `autonomous` or `none` | Read operations, personal workspace |
| `intermediate` | Medium | `borderline` | Write operations, shared resources |
| `critical` | High/Critical | `always` or `tribunal` | Financial, production, sensitive data |

### Risk Tiers and Review Modes

```
┌─────────────────────────────────────────────────┐
│ critical  │  always / tribunal review           │
├─────────────────────────────────────────────────┤
│ intermediate │  borderline review               │
├─────────────────────────────────────────────────┤
│ low       │  autonomous / no review             │
└─────────────────────────────────────────────────┘
```

**Review modes:**
- `always` — Every action reviewed, regardless of confidence
- `borderline` — Review only when confidence is below threshold
- `tribunal` — Multi-assessor panel for high-stakes decisions
- `autonomous` — No review needed if deterministic resolution succeeds
- `none` — No review at all (lowest trust requirement)

## Decision Patterns

Four routing patterns, ordered by complexity:

### 1. `single_model`

One LLM call. Simplest pattern.

```
Request → Model → Response
```

**Use when:** Low-to-medium risk, model confidence is generally sufficient.

### 2. `primary_reviewer`

Primary model generates, reviewer model validates.

```
Request → Primary Model → Reviewer Model → Response
                              │
                              └── Disagree → Fallback strategy
```

**Use when:** Medium risk where a second opinion catches errors.

### 3. `tribunal`

Multiple assessors vote, arbiter resolves disagreements.

```
Request → Assessor 1 ─┐
        → Assessor 2 ─┼── Votes → Agreement? → Response
        → Assessor 3 ─┘              │
                                      └── Disagree → Arbiter → Response
```

**Use when:** Critical decisions requiring consensus or formal deliberation.

**Configuration:**

```json
{
  "tribunalConfig": {
    "panelId": "finance-panel",
    "assessorCount": 3,
    "requiredAgreement": 2,
    "arbiterPolicy": "conservative"
  }
}
```

### 4. `a5_hybrid`

Deterministic-first with tribunal fallback. The recommended pattern for most production use.

```
Request → Deterministic Evaluation
              │
              ├── High confidence → Response (skip model)
              └── Low confidence → Tribunal → Response
```

**Use when:** You want deterministic speed for clear cases and tribunal safety for ambiguous ones.

## Deterministic-First Routing

The core routing philosophy: avoid model calls when rules can decide.

### Decision Tree

```
Action received
     │
     ▼
Surface binding exists?
     │
     ├── No → safe_block (fail-closed)
     │
     ▼ Yes
Route config loaded?
     │
     ├── No → safe_block
     │
     ▼ Yes
Deterministic extractor available?
     │
     ├── No → Execute bound pattern (model call)
     │
     ▼ Yes
Extract deterministic candidate
     │
     ▼
Confidence above threshold?
     │
     ├── No → Execute bound pattern (model call)
     │
     ▼ Yes
Safe to execute without model?
     │
     ├── No → Execute bound pattern (model call)
     │
     ▼ Yes
Return deterministic result (no model call)
```

### Route Classes

The route resolver assigns one of four classes:

| Route Class | Meaning | Model Call? |
|-------------|---------|-------------|
| `deterministic_only` | Fully resolved by rules | Never |
| `deterministic_first_a5_on_uncertain` | Try deterministic, fall back to model | Only if uncertain |
| `not_ready_data_or_policy_gap` | Missing data or policy coverage | safe_block |
| `frontier_or_human_required` | Beyond automated capability | Requires human |

### Deterministic Candidates

When a deterministic extractor produces a candidate:

```typescript
interface DeterministicDecisionCandidate {
  surfaceId: string;
  routeClass: string;
  decision: unknown | null;
  confidence: number;              // 0-1
  confidenceTier: 'high_confidence' | 'borderline' | 'no_decision';
  ruleSetId: string;
  ruleSetVersion: number;
  ruleSetHash: string;
  rulesFired: string[];
  missingEvidence: string[];
  usedInputFields: string[];
  ignoredUntrustedFields: string[];
  rationale: string;
  safeToExecuteWithoutModel: boolean;
}
```

**Key fields:**
- `confidence`: How certain the deterministic evaluation is (0.0 - 1.0)
- `confidenceTier`: Bucketed confidence for routing decisions
- `safeToExecuteWithoutModel`: Whether to skip the model call
- `missingEvidence`: What's needed for higher confidence

## Safe-Block

The fail-closed default. When routing cannot produce a decision:

- Unknown surface (no binding) → `safe_block`
- Model unavailable → `safe_block`
- Policy gap (no applicable rules) → `safe_block`
- Configuration error → `safe_block`

Safe-block means the action is **not allowed** but it's not a policy deny — it's a routing failure. The distinction matters for audit: safe_block indicates a gap to fix, not a rule violation.

```typescript
// DecisionRunnerResult with safe_block
{
  verdict: 'safe_block',
  output: null,
  explanation: 'No surface binding found for "unknown-surface". Action blocked by safe default.',
  // ...
}
```

## Surface Bindings

Configure surface-to-pattern mapping:

```json
{
  "surfaceId": "finance.transactions",
  "pattern": "a5_hybrid",
  "roles": {
    "primary": {
      "modelPolicy": "conservative",
      "temperature": 0.1
    },
    "reviewer": {
      "modelPolicy": "strict",
      "temperature": 0.0
    }
  },
  "fallbackPattern": "single_model",
  "fallbackStrategy": "safe_block",
  "confidenceThreshold": 0.85,
  "tribunalConfig": {
    "panelId": "finance-panel",
    "assessorCount": 3,
    "requiredAgreement": 2
  }
}
```

### Fallback Strategies

When the primary pattern fails:

| Strategy | Behavior |
|----------|----------|
| `safe_block` | Block the action (default, safest) |
| `downgrade_pattern` | Try simpler pattern (e.g., tribunal → single_model) |
| `accept_primary` | Use primary result even without reviewer confirmation |

## Confidence Thresholds

The confidence threshold determines when deterministic evaluation is "good enough":

```
Confidence ≥ threshold → deterministic result accepted
Confidence < threshold → fall through to model-assisted pattern
```

**Recommended thresholds:**

| Context | Threshold | Rationale |
|---------|-----------|-----------|
| Low-risk reads | 0.7 | False positives are inexpensive |
| Standard operations | 0.85 | Balance speed and safety |
| Financial/critical | 0.95 | Minimize errors |
| Compliance-sensitive | 0.99 | Near-certainty required |

## Configuration

### Trust Suite Files

Located in `config/trust-suite/`:

**`trust-policy.json`** — Per-surface risk and review:
```json
{
  "surfaces": {
    "finance.transactions": {
      "riskTier": "critical",
      "reviewMode": "tribunal"
    },
    "workspace.files": {
      "riskTier": "low",
      "reviewMode": "autonomous"
    }
  }
}
```

**`surface-bindings.json`** — Pattern configuration per surface.

**`surface-registry.json`** — Surface metadata and capability declarations.

### Runtime Route Config

Loaded via `RuntimeRouteResolver.loadConfigFromJson()`:

```json
{
  "routes": {
    "finance.transactions": {
      "routeClass": "deterministic_first_a5_on_uncertain",
      "confidenceThreshold": 0.95,
      "fallbackPattern": "tribunal"
    },
    "workspace.files": {
      "routeClass": "deterministic_only",
      "confidenceThreshold": 0.7
    }
  }
}
```

## Autonomy Status

Each decision result includes an autonomy status:

| Status | Meaning |
|--------|---------|
| `verified_autonomous` | Deterministic evaluation succeeded, no model needed |
| `safe_block` | Could not resolve, action blocked |
| `failed` | Pattern execution error |

## Evidence Bridge

Deterministic decisions produce evidence records just like model-assisted ones:

```typescript
// Evidence from deterministic path
{
  operationType: 'route_decision',
  payload: {
    routeClass: 'deterministic_only',
    confidence: 0.92,
    rulesFired: ['allow-read-tools'],
    skipModelCall: true,
    rationale: 'High-confidence deterministic match on read_file action'
  }
}
```

This ensures the audit trail is complete regardless of which path was taken.

## Related Documentation

- [Architecture](./ARCHITECTURE.md) — System design overview
- [Providers](./PROVIDERS.md) — How provider mode affects pattern availability
- [Policy Authoring Guide](./POLICY-AUTHORING-GUIDE.md) — Rules that feed deterministic evaluation
- [Evidence Chain Guide](./EVIDENCE-CHAIN-GUIDE.md) — How routing evidence is recorded
- [Security](./SECURITY.md) — Fail-closed security guarantees
