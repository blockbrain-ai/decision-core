# Clause Schema Reference

Decision Core models policy as a graph of typed clauses. Each clause represents a discrete policy statement with formal semantics. This reference documents all 12 clause types, control types, the approval lifecycle, and graph edge types.

## Clause Types

### 1. `obligation`

A requirement that **must** be fulfilled. Violation triggers deny or escalation.

```yaml
type: obligation
text: "All financial transactions over $10,000 must be logged with full audit trail"
controls:
  - type: evidence_field_required
    field: auditTrail
```

**Enforcement:** If the obligation is not satisfied (evidence missing, condition unmet), the action is blocked.

### 2. `prohibition`

An action that **must not** occur. Maps directly to deny rules.

```yaml
type: prohibition
text: "Personal health information must not be transmitted to external APIs"
controls:
  - type: decision_label_forbidden
    label: external_transmission
```

**Enforcement:** If the prohibited condition is detected, the action is immediately denied.

### 3. `permission`

An explicit grant of allowed behaviour. Counterpart to prohibition.

```yaml
type: permission
text: "Authorized analysts may query aggregated financial reports"
controls: []
```

**Enforcement:** Enables actions that would otherwise be blocked by a broader prohibition, subject to deny-wins arbitration.

### 4. `threshold`

A quantitative limit that triggers different actions at different levels.

```yaml
type: threshold
text: "Transactions above $5,000 require dual authorization"
controls:
  - type: amount_threshold
    field: amount
    threshold: 5000
    currency: USD
```

**Enforcement:** Evaluates the numeric value against the threshold. Below threshold: allow. Above threshold: applies the control (typically approve_required).

### 5. `exception`

A carve-out from another clause. References the exempted clause by ID.

```yaml
type: exception
text: "Emergency maintenance operations are exempt from the weekend deployment ban"
# Links via graph edge: exempts → weekend-deploy-prohibition
```

**Enforcement:** When the exception conditions are met, the referenced clause is not enforced for that evaluation.

### 6. `definition`

Establishes terminology or scope used by other clauses. Not directly enforced.

```yaml
type: definition
text: "'Sensitive data' means any PII, PHI, financial records, or authentication credentials"
```

**Enforcement:** None directly. Other clauses reference definitions to resolve ambiguity.

### 7. `evidence_requirement`

Specifies what evidence must be collected for an action to proceed.

```yaml
type: evidence_requirement
text: "All deployment decisions must include the commit SHA, deployer identity, and test results"
controls:
  - type: evidence_field_required
    field: commitSha
  - type: evidence_field_required
    field: deployerIdentity
  - type: evidence_field_required
    field: testResults
```

**Enforcement:** The action is blocked if required evidence fields are missing from the evaluation context.

### 8. `approval_requirement`

Mandates human approval before an action proceeds.

```yaml
type: approval_requirement
text: "Production database schema changes require DBA approval"
controls:
  - type: dual_authorization_required
    role: dba
```

**Enforcement:** Triggers the approval workflow. Action is held pending until approved, rejected, or expired.

### 9. `human_oversight_requirement`

Requires a human to review the action, but does not necessarily block execution.

```yaml
type: human_oversight_requirement
text: "AI-generated customer communications must be reviewed by a human before sending"
controls:
  - type: evidence_field_required
    field: humanReviewerId
```

**Enforcement:** Depending on autonomy level, may block (strict) or log (advisory) when oversight has not occurred.

### 10. `protected_attribute_constraint`

Guards against discriminatory or sensitive attribute usage.

```yaml
type: protected_attribute_constraint
text: "Decisions must not use race, gender, age, or disability status as factors"
controls:
  - type: decision_label_forbidden
    label: uses_protected_attribute
```

**Enforcement:** If the decision context or model output references protected attributes, the action is denied.

### 11. `routing_constraint`

Controls which routing pattern a surface must use.

```yaml
type: routing_constraint
text: "Critical financial decisions must use tribunal pattern with 3 assessors"
controls:
  - type: sanctions_hold
    pattern: tribunal
    minAssessors: 3
```

**Enforcement:** Overrides the default surface binding for matching actions, forcing the specified pattern.

### 12. `general`

Catch-all type for policy statements that don't fit other categories.

```yaml
type: general
text: "The system shall log all policy evaluation outcomes for compliance reporting"
controls: []
```

**Enforcement:** Varies based on attached controls. May be purely informational.

## Control Types

Controls are enforcement mechanisms attached to clauses:

| Control Type | Description | Parameters |
|-------------|-------------|------------|
| `amount_threshold` | Triggers when a numeric field exceeds a limit | `field`, `threshold`, `currency` |
| `sanctions_hold` | Holds action pending external check | `pattern`, `minAssessors` |
| `dual_authorization_required` | Requires two-party approval | `role` |
| `evidence_field_required` | Requires a specific field in evidence | `field` |
| `decision_label_forbidden` | Blocks if a label is present in context | `label` |

Controls are evaluated after clause matching. A clause can have zero or many controls.

## Clause Statuses

Clauses progress through a lifecycle:

```
draft → approved → active → superseded
```

| Status | Meaning |
|--------|---------|
| `draft` | Written but not reviewed. Not enforced. |
| `approved` | Reviewed and accepted. Ready for activation. |
| `active` | Currently enforced. Appears in compiled rule sets. |
| `superseded` | Replaced by a newer version. Retained for audit history. |

Only `active` clauses are included in compiled rule sets and evaluated during enforcement.

## Approval Lifecycle

Clauses of type `approval_requirement` trigger the approval workflow:

```
Action triggers clause
       │
       ▼
ApprovalRequest created (status: pending)
       │
       ├── Approved → action proceeds, status: approved
       ├── Rejected → action blocked, status: rejected
       ├── Expired (TTL exceeded) → action blocked, status: expired
       └── Cancelled (requestor withdraws) → action blocked, status: cancelled
```

**Approval priorities:** `low`, `medium`, `high`, `urgent`

**Constraint drift:** If conditions change between request and resolution (e.g., amount increases), the `constraintDrift` field tracks the delta. Significant drift may require re-evaluation.

**Execution tracking:**
- `executionStatus`: Whether the approved action was actually executed
- `rollbackAvailable`: Whether the action can be undone if the approval is later revoked

## Graph Edge Types

Clauses form a directed graph. Edges express relationships:

| Edge Type | Meaning | Example |
|-----------|---------|---------|
| `depends_on` | Clause requires another to be active | Evidence rule depends on definition |
| `conflicts_with` | Mutual exclusion | Two contradictory policies |
| `supersedes` | Replaces an older clause | Updated compliance rule |
| `refines` | Adds specificity to a general clause | Industry-specific refinement |
| `exempts` | Creates an exception to a clause | Emergency override |
| `requires_evidence` | Links to evidence requirements | Obligation needs proof |
| `requires_approval` | Links to approval requirement | Action needs sign-off |
| `constrains` | Limits the scope of another clause | Threshold on permission |
| `delegates_to` | Transfers authority | Manager delegates to team lead |
| `inherits_from` | Derives properties from parent | Child policy inherits controls |
| `triggers` | Activation causes evaluation of target | Threshold triggers approval |
| `blocks` | Prevents target from being satisfied | Prohibition blocks permission |
| `supplements` | Adds additional requirements | Extra evidence for high-risk |
| `narrows` | Reduces scope of target clause | Restricts broad permission |
| `broadens` | Expands scope of target clause | Extends coverage |
| `cross_references` | Informational link | Related policy in another domain |

### Graph Queries

The clause graph supports traversal queries:

```typescript
// Find all clauses that depend on a definition
const dependents = await graphQueryService.findByTarget(tenantId, definitionClauseId);

// Impact analysis: what breaks if we deactivate a clause?
const impact = await impactAnalysisService.analyze(tenantId, clauseId);
// Returns: affected clauses, broken dependencies, orphaned edges
```

## Compiled Rule Sets

Active clauses are compiled into executable rule sets:

```typescript
interface CompiledRuleSet {
  id: string;
  tenantId: TenantId;
  version: number;
  status: 'draft' | 'active';
  clauseIds: string[];      // Source clauses
  compiledAt: string;       // ISO timestamp
  activatedAt?: string;     // When made active
  snapshotHash: string;     // Content hash for replay
}
```

Only one rule set can be `active` per tenant at a time. Activating a new set deactivates the previous one.

**Compilation flow:**
1. Select active clauses for tenant
2. Resolve graph edges (dependencies, conflicts)
3. Generate executable rule expressions
4. Hash the content for versioning
5. Store compiled set (inactive until explicitly activated)

## Clause Versioning

Each clause edit creates a new version entry in the clause version chain:

```typescript
interface ClauseVersionEntry {
  clauseId: string;
  version: number;
  text: string;
  normalizedHash: string;         // SHA-256 of normalized text
  previousVersionHash: string;    // Links to prior version
  chainHash: string;              // Chain integrity hash
}
```

This enables:
- **Diff detection:** Compare `normalizedHash` across versions
- **Tamper detection:** Verify `chainHash` links
- **Historical replay:** Reconstruct what the clause said at any point in time

## Related Documentation

- [Architecture](./ARCHITECTURE.md) — Knowledge system overview
- [Policy Authoring Guide](./POLICY-AUTHORING-GUIDE.md) — Writing rules
- [Evidence Chain Guide](./EVIDENCE-CHAIN-GUIDE.md) — How clause evidence links to decisions
- [Trust Routing Guide](./TRUST-ROUTING-GUIDE.md) — How routing constraints work
