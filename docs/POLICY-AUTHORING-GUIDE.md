# Policy Authoring Guide

This guide covers writing policy rules for Decision Core. Rules define what actions are allowed, denied, or require approval.

## Structured Policy Documents

For deterministic policy compilation, prefer structured policy documents over prose-only extraction. A structured Markdown policy uses YAML frontmatter plus fenced `decision-core-clause` blocks:

````markdown
---
schema_version: "1.0.0"
policy_id: dc.finance.example
surfaces: [finance.processing]
owner: compliance@example.com
---

```decision-core-clause
clause_id: dc.finance.example.amount
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
evidence_required: [amount, currency]
```
````

Use the CLI quality gates before ingesting:

```bash
decision-core validate ./policy.md
decision-core lint ./policy.md --surface-contracts ./surface-contracts.yaml
decision-core generate-tests --rule-set ./compiled-rules.json --output ./policy-tests.json
```

The linter validates surface IDs, decision labels, input fields, safe fallback coverage, protected-attribute review flags, and route classes. Pure YAML structured policies are also supported with top-level `frontmatter` and `clauses` keys.

## Rule Format

Rules are defined in YAML policy packs or created programmatically. Each rule has:

```yaml
- name: block-destructive-ops
  description: Prevent accidental data loss from destructive operations
  action: deny
  surfaces: ["*"]
  tools: ["delete_*", "drop_*", "rm_*", "destroy_*"]
  priority: 100
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique rule identifier |
| `description` | string | yes | Human-readable explanation |
| `action` | enum | yes | `allow`, `deny`, or `approve_required` |
| `surfaces` | string[] | yes | Surface patterns this rule applies to |
| `tools` | string[] | yes | Tool/action patterns to match |
| `priority` | number | yes | Higher priority rules take precedence in reporting |
| `conditions` | object | no | Additional constraints (see below) |

### Actions

- **`allow`** — Permit the action to proceed.
- **`deny`** — Block the action. Takes precedence over all allow rules (deny-wins).
- **`approve_required`** — Pause execution pending human approval. Takes precedence over allow but not deny.

### Priority

Priority affects rule ordering in audit reports and matched-policy lists. It does **not** override deny-wins arbitration — a deny rule at priority 1 still beats an allow rule at priority 1000.

## Deny-Wins Arbitration

The core safety invariant: if any applicable rule returns `deny`, the final verdict is `deny` regardless of other rules.

**Precedence:** `deny > approve_required > allow`

```
Rules evaluated for action "deploy.production":
  ✓ allow-deploy (priority 10, action: allow)
  ✓ require-approval-prod (priority 50, action: approve_required)
  ✓ block-weekend-deploy (priority 100, action: deny)

Final verdict: deny (block-weekend-deploy matched)
```

All matched rules appear in the `matchedPolicies` array of the verdict, even those overridden by deny-wins.

## Glob Patterns

Tool and surface patterns use glob matching:

| Pattern | Matches | Does Not Match |
|---------|---------|----------------|
| `read_*` | `read_file`, `read_db` | `read.file`, `write_file` |
| `*.delete` | `file.delete`, `db.delete` | `file.delete.confirm` |
| `**` | Everything | — |
| `deploy.*` | `deploy.staging`, `deploy.production` | `deploy.staging.rollback` |

- `*` matches a single segment (no dots).
- `**` matches any depth.

## Conditions

Optional constraints that narrow when a rule fires:

```yaml
- name: limit-financial-ops
  action: approve_required
  surfaces: ["*"]
  tools: ["transfer_*", "payment_*"]
  priority: 80
  conditions:
    maxAmountUsd: 10000
    maxCountPerDay: 5
    cooldownMinutes: 30
    timeWindowStart: "09:00"
    timeWindowEnd: "17:00"
    minConfidence: 0.8
```

| Condition | Type | Description |
|-----------|------|-------------|
| `maxAmountUsd` | number | Block if financial impact exceeds threshold |
| `maxCountPerDay` | integer | Block after N actions per day |
| `cooldownMinutes` | integer | Block if last action was within cooldown |
| `timeWindowStart` | HH:MM | Allow only within time window (UTC) |
| `timeWindowEnd` | HH:MM | Allow only within time window (UTC) |
| `minConfidence` | 0-1 | Require minimum confidence score |

Conditions are AND-combined: all specified conditions must be satisfied for the rule to apply.

## Surface Bindings

Surfaces represent the context where an action originates. Rules can target specific surfaces:

```yaml
surfaces:
  - name: shared-workspace
    description: Team-shared resources
    trustTier: elevated
    category: collaboration

  - name: personal
    description: User's private workspace
    trustTier: standard
    category: workspace
```

Rules reference surfaces by name pattern:

```yaml
- name: require-approval-shared
  action: approve_required
  surfaces: ["shared-workspace"]
  tools: ["write_*", "delete_*"]
  priority: 50
```

Use `["*"]` to match all surfaces.

## Trust Tiers

Surfaces are assigned trust tiers that control audit and approval requirements:

```yaml
trustTiers:
  - name: standard
    requiresApproval: false
    requiresAudit: false
    riskLevel: low

  - name: elevated
    requiresApproval: true
    requiresAudit: true
    riskLevel: medium

  - name: critical
    requiresApproval: true
    requiresAudit: true
    riskLevel: critical
```

Trust tiers layer on top of rule evaluation — even if a rule says `allow`, an elevated surface may still require audit logging.

## Policy Packs

Pre-built rule sets for common scenarios:

| Pack | Profile | Description |
|------|---------|-------------|
| `personal` | personal | Permissive reads, blocks destructive |
| `team` | team | Approval for shared writes |
| `fintech` | enterprise | Financial constraints, regulatory compliance |
| `healthcare` | enterprise | Patient data sensitivity, HIPAA-inspired |
| `saas` | enterprise | Isolation checks, API rate limiting |

Load a pack:

```typescript
import { fromPolicyPack } from '@decision-core/core';

const dc = await fromPolicyPack('fintech', {
  tenantId: 'acme-corp',
});
```

Or reference by path:

```typescript
const dc = await quickStart({
  profile: 'team',
  // Loads config/packs/team.yaml
});
```

## Writing Custom Rules

### Example: Deny external API calls during incident

```yaml
- name: block-external-during-incident
  description: Prevent external API calls when incident mode is active
  action: deny
  surfaces: ["*"]
  tools: ["api_call_*", "webhook_*", "http_*"]
  priority: 200
  conditions:
    # Activated via runtime context flag
```

### Example: Require approval for high-value operations

```yaml
- name: approve-high-value
  description: Require human approval for operations over $5000
  action: approve_required
  surfaces: ["finance", "billing"]
  tools: ["transfer_*", "refund_*", "credit_*"]
  priority: 90
  conditions:
    maxAmountUsd: 5000
```

### Example: Allow read-only during maintenance window

```yaml
- name: maintenance-read-only
  description: Only allow reads during maintenance windows
  action: deny
  surfaces: ["*"]
  tools: ["write_*", "create_*", "update_*", "delete_*"]
  priority: 150
  conditions:
    timeWindowStart: "02:00"
    timeWindowEnd: "04:00"
```

## Programmatic Rule Creation

Rules can be created via the SDK:

```typescript
import { TenantId } from '@decision-core/core';

await policyRuleRepo.create('tenant-1' as TenantId, {
  name: 'block-deploy-friday',
  description: 'No deployments on Fridays',
  actionType: 'deploy.*',
  verdict: 'deny',
  policyType: 'business',
  riskClass: 'B',
  enforcementPoint: 'pre_decision',
  priority: 80,
  enabled: true,
  constraints: {
    // Custom constraint logic
  },
});
```

## Autonomy Levels

Rules interact with autonomy levels (0-5) which determine enforcement strictness:

| Level | Mode | Deny | Approve Required |
|-------|------|------|-----------------|
| 0-1 | Strict | Blocks | Blocks |
| 2-3 | Permissive | Blocks | Logged, allowed |
| 4-5 | Advisory | Logged, allowed | Logged, allowed |

Set autonomy level per evaluation:

```typescript
const result = await pep.enforce(tenantId, 'pre_decision', 'deploy.production', {
  autonomyLevel: 2, // permissive mode
});
```

## Testing Rules

Use the CLI to test rule evaluation:

```bash
# Evaluate a specific action
decision-core evaluate --surface shared --action file.delete

# Check which rules match
decision-core evaluate --surface finance --action transfer.execute --context '{"amount": 15000}'
```

Or use the policy rule test harness programmatically:

```typescript
import { createPolicyRuleTestHarness } from '@decision-core/core';

const harness = createPolicyRuleTestHarness();
const result = harness.runAgainstContext(compiledRuleSet, {
  actionType: 'deploy.production',
  surface: 'ci-pipeline',
  context: { dayOfWeek: 'friday' },
});
```

## Common Patterns

### Layered deny + allow

```yaml
# Broad deny
- name: deny-all-writes
  action: deny
  surfaces: ["production"]
  tools: ["write_*", "create_*", "update_*", "delete_*"]
  priority: 100

# Narrow allow does NOT override — deny-wins
- name: allow-config-write
  action: allow
  surfaces: ["production"]
  tools: ["write_config"]
  priority: 50
```

The above does **not** allow `write_config` because deny-wins. To permit specific tools within a broad deny, restructure:

```yaml
# Deny specific dangerous tools instead
- name: deny-destructive-writes
  action: deny
  surfaces: ["production"]
  tools: ["delete_*", "drop_*"]
  priority: 100

# Allow general writes
- name: allow-writes
  action: allow
  surfaces: ["production"]
  tools: ["write_*", "create_*", "update_*"]
  priority: 50
```

### Progressive trust

```yaml
# Low-trust: deny by default
- name: deny-unknown
  action: deny
  surfaces: ["*"]
  tools: ["**"]
  priority: 1

# Medium-trust: allow reads
- name: allow-reads
  action: allow
  surfaces: ["*"]
  tools: ["read_*", "list_*", "get_*"]
  priority: 10

# High-trust: allow writes with approval
- name: approve-writes
  action: approve_required
  surfaces: ["*"]
  tools: ["write_*", "create_*"]
  priority: 20
```

## Designing A Hermes Policy Pack

When Hermes agents are governed by Decision Core, the DC plugin sends the raw
tool function name as the `action` in every `/evaluate` request. This section
walks through designing a policy pack for a multi-agent Hermes deployment.

See the [Hermes Integration Guide](./INTEGRATION-GUIDES/hermes.md#hermes-tool-function-reference)
for the complete list of tool function names.

### Step 1: Inventory Enabled Toolsets

Run `hermes tools list` for each agent to see which toolsets are enabled.
Disabled toolsets never fire `/evaluate` requests, so you only need rules for
enabled ones.

### Step 2: Classify Tools By Risk

Assign each tool a risk class:

| Risk | Tools | Rationale |
|------|-------|-----------|
| **A — read-only, low impact** | `web_search`, `web_extract`, `read_file`, `search_files`, `vision_analyze`, `session_search`, `clarify`, `todo`, `skills_list`, `skill_view`, `browser_snapshot`, `browser_scroll`, `browser_back`, `browser_get_images`, `browser_vision`, `browser_console`, `image_generate`, `text_to_speech` | No side effects or external mutations |
| **B — write, moderate impact** | `write_file`, `patch`, `terminal`, `process`, `execute_code`, `memory`, `browser_navigate`, `browser_click`, `browser_type`, `browser_press`, `delegate_task`, `cronjob`, `send_message`, `skill_manage` | Can modify state, execute code, or send messages |
| **C — high impact, needs oversight** | `computer_use`, `browser_cdp`, `browser_dialog` | Full desktop or raw browser control |

If Hermes uses Brave Free for search, keep `web_search` in Risk A but only keep
`web_extract` there once a real extract backend is configured. Brave Free is
search-only and does not satisfy `web_extract` by itself.

### Step 3: Map Roles To Risk Tiers

Decide which roles may use each risk tier:

```yaml
# Risk A: all roles (no requiredRoles → open to any authenticated agent)
- name: hermes-allow-web-search
  actionTypePattern: "web_search"
  riskClass: A
  defaultVerdict: allow
  priority: 100
  enabled: true

# Risk B: leadership and operations only
- name: hermes-allow-terminal
  actionTypePattern: "terminal"
  riskClass: B
  requiredRoles: [owner, managing-director, executive, ceo, operations]
  defaultVerdict: allow
  priority: 90
  enabled: true

# Risk C: approval required, limited roles
- name: hermes-approve-computer-use
  actionTypePattern: "computer_use"
  riskClass: C
  requiredRoles: [owner, managing-director, ceo]
  requireApproval: true
  approverRole: owner
  priority: 95
  enabled: true
```

### Step 4: Handle `denyUnknownDefault`

With `denyUnknownDefault: true`, any tool not matched by a rule is denied. This
is the recommended production default — it means new tools added by a Hermes
update are automatically blocked until you add a policy rule.

The tradeoff: after a Hermes upgrade that adds new tools, agents will be denied
those tools until you update the policy pack. Check `hermes tools list` after
upgrades and add rules for any new function names.

### Step 5: Test The Matrix

For each agent, verify that the policy produces the expected verdict for every
enabled tool:

```bash
DC_TOKEN=<agent-token>

for tool in web_search terminal read_file memory computer_use; do
  echo -n "$tool: "
  curl -s -X POST http://127.0.0.1:3100/evaluate \
    -H "Authorization: Bearer $DC_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"surfaceId\":\"hermes\",\"action\":\"$tool\",\"context\":{}}" \
    | jq -r '.data.verdict'
done
```

Test at least:
- A read-only tool → expect `allow` for all roles
- A write tool → expect `allow` for authorized roles, `deny` for others
- A high-risk tool → expect `approve_required` for authorized roles
- An unknown action → expect `deny` (confirms `denyUnknownDefault`)

### Worked Example: Five-Person Organisation

This example matches the deployment described in the
[Five-Person Setup Runbook](./runbooks/decision-core-hermes-gbrain-five-person-setup-guide-2026-05-19.md).

```yaml
version: "1.0.0"
name: my-company-hermes-org
denyUnknownDefault: true

rules:
  # ── Risk A: open to all agents ──
  - name: hermes-allow-web-search
    actionTypePattern: "web_search"
    riskClass: A
    priority: 100
    defaultVerdict: allow
    enabled: true

  - name: hermes-allow-read-file
    actionTypePattern: "read_file"
    riskClass: A
    priority: 100
    defaultVerdict: allow
    enabled: true

  - name: hermes-allow-search-files
    actionTypePattern: "search_files"
    riskClass: A
    priority: 100
    defaultVerdict: allow
    enabled: true

  # ... (add one rule per Risk A tool)

  # ── Risk B: leadership + operations ──
  - name: hermes-allow-terminal
    actionTypePattern: "terminal"
    riskClass: B
    priority: 90
    requiredRoles: [owner, managing-director, executive, ceo, operations]
    defaultVerdict: allow
    enabled: true

  - name: hermes-allow-write-file
    actionTypePattern: "write_file"
    riskClass: B
    priority: 90
    requiredRoles: [owner, managing-director, executive, ceo, operations]
    defaultVerdict: allow
    enabled: true

  # ── Risk B: leadership only (no operations) ──
  - name: hermes-allow-memory
    actionTypePattern: "memory"
    riskClass: B
    priority: 90
    requiredRoles: [owner, managing-director, executive, ceo]
    defaultVerdict: allow
    enabled: true

  - name: hermes-allow-delegate-task
    actionTypePattern: "delegate_task"
    riskClass: B
    priority: 90
    requiredRoles: [owner, managing-director, executive, ceo]
    defaultVerdict: allow
    enabled: true

  # ── Risk C: approval required ──
  - name: hermes-approve-computer-use
    actionTypePattern: "computer_use"
    riskClass: C
    priority: 95
    requiredRoles: [owner, managing-director, ceo]
    requireApproval: true
    approverRole: owner
    enabled: true
```

The pattern: Risk A rules have no `requiredRoles` (any authenticated agent
passes). Risk B rules scope by role. Risk C rules add `requireApproval`. The
`denyUnknownDefault` catch-all blocks everything not explicitly covered.

## Related Documentation

- [Architecture](./ARCHITECTURE.md) — How policy engine fits in the system
- [Clause Schema Reference](./CLAUSE-SCHEMA-REFERENCE.md) — Formal clause types
- [Trust Routing Guide](./TRUST-ROUTING-GUIDE.md) — How trust tiers affect routing
- [Multi-Tenancy](./MULTI-TENANCY.md) — Tenant-scoped policy evaluation
- [FAQ](./FAQ.md) — Common policy questions
