# Compliance Audit — Governance Gap Detection

## Metadata

| Field       | Value                                                                 |
|-------------|-----------------------------------------------------------------------|
| Name        | compliance-audit                                                      |
| Description | Review decisions, detect governance gaps, and generate compliance reports |
| Triggers    | "run audit", "check compliance", "audit decisions", "governance gaps", "evidence integrity" |
| Tools       | `dc_audit_run`, `dc_audit_gaps`, `dc_audit_evidence`                  |
| Output      | Compliance report (Markdown + JSON) with gaps and recommendations     |

## How to Use This Skill

You are an agent helping a user audit their Decision Core governance setup. The audit reviews recent decisions and identifies gaps — missing policies, surfaces without trust tiers, low-confidence auto-approvals, tampered evidence, and tools outside governance.

**Important rules:**
- This is a **read-only** audit. It never modifies decisions, policies, or evidence.
- Present gaps by severity: critical first, then warning, then info.
- For each gap, explain what it means and what the user should do about it.
- Link remediation actions to other skills: use policy-author (6.2) to create missing rules, onboarding (6.1) to set up trust tiers.
- Always include the time range and tenant context in your report.

---

## Running a Full Audit

**Goal:** Generate a complete compliance report for a tenant's decision history.

### How It Works

1. User asks for an audit (e.g., "audit my recent decisions" or "check compliance")
2. Call `dc_audit_run` with optional time range and surface filters
3. Present the report to the user:
   - Summary metrics (total decisions, policy coverage %, evidence integrity %)
   - Gap counts by severity
   - Each gap with description, affected surfaces, and recommendation
   - Overall recommendations
4. Offer to help fix critical gaps using other skills

### Example Interaction

```
User: "Run a compliance audit on my decisions from the last week"

Agent calls: dc_audit_run({
  from: "2026-04-29T00:00:00.000Z",
  to: "2026-05-06T00:00:00.000Z"
})

Agent presents:
  Compliance Audit Report
  =======================
  Total Decisions: 47
  Policy Coverage: 82%
  Evidence Integrity: 100%

  Critical Gaps (2):
  - [missing_trust_tier] Surface "api-gateway" has no trust tier assignment
  - [bypassed_governance] 3 decisions matching rule "Deny: db.drop" were auto-approved

  Warning Gaps (1):
  - [missing_policy] Tool "slack.post" has no enabled policy rules

  Recommendations:
  - Assign trust tiers to all active surfaces
  - Investigate bypassed governance for risk class A rules
  - Create policy rules for uncovered tools

  Would you like me to help fix the critical gaps?
```

---

## Checking Gaps Only

**Goal:** Quick gap check without a full report.

### How It Works

1. Call `dc_audit_gaps` with optional severity filter
2. Returns only the gaps list
3. Useful for quick checks or CI/CD integration

### Example

```
User: "Show me only critical compliance gaps"

Agent calls: dc_audit_gaps({ severity: "critical" })

Agent presents:
  2 critical gaps found:
  1. [missing_trust_tier] Surface "api-gateway" has no trust tier assignment
  2. [bypassed_governance] 3 decisions bypassed approval for rule "Deny: db.drop"
```

---

## Checking Evidence Integrity

**Goal:** Verify that evidence chains haven't been tampered with.

### How It Works

1. Call `dc_audit_evidence` with specific correlation IDs
2. Returns integrity status for each chain
3. Broken chains indicate potential tampering or data corruption

### Example

```
User: "Check evidence integrity for correlation abc-123"

Agent calls: dc_audit_evidence({ correlationIds: ["abc-123"] })

Agent presents:
  Evidence Integrity Check:
  - abc-123: VALID (5 records, chain intact)
```

---

## Gap Categories

| Category              | Description                                              | Typical Severity |
|-----------------------|----------------------------------------------------------|-----------------|
| `missing_policy`      | Tool used in decisions has no matching enabled policy     | warning/critical |
| `missing_trust_tier`  | Surface has no trust tier or binding configuration        | critical        |
| `evidence_integrity`  | Evidence chain hash verification failed                  | critical        |
| `low_confidence`      | Decisions auto-approved with confidence below 0.7        | warning/critical |
| `unaudited_tool`      | Tool has zero policy rules (not even disabled drafts)    | info            |
| `bypassed_governance` | Decisions matching approval-required rules were auto-approved | critical    |

## Severity Classification

- **Critical**: Unprotected sensitive surfaces, bypassed governance, tampered evidence
- **Warning**: Missing best practices, low-confidence decisions, uncovered tools
- **Info**: Suggestions for improving governance documentation

---

## Remediation Links

When gaps are found, suggest these remediation paths:

| Gap Type             | Remediation                                                |
|----------------------|------------------------------------------------------------|
| Missing policy       | Use `dc_author_from_text` to create rules                  |
| Missing trust tier   | Add entries to trust suite configuration                   |
| Evidence integrity   | Investigate immediately — potential security incident       |
| Low confidence       | Upgrade routing pattern to primary-reviewer or tribunal     |
| Unaudited tool       | Create explicit allow/deny rules for governance clarity     |
| Bypassed governance  | Check enforcement point wiring in decision pipeline        |

---

## Organisation Mode Audit

When the deployment uses organisation mode (`.decision-core/agents.yaml` exists), the audit adds these checks:

### Identity Spoofing

Verify that token-bound identity cannot be bypassed:
- An agent's bearer token must resolve to exactly one `agentId` via the auth binding store
- If a request body includes `agentId` that doesn't match the authenticated token, the server must reject with 403
- Any identity mismatch should be flagged as a critical gap

### Tool Drift

Check for unclassified tools:
- New tools added to Hermes/OpenClaw that have no matching policy rule
- With `denyUnknownDefault: true`, unknown tools are denied — but the audit should surface them for the owner to review and classify
- Use `decision-core provision --verify` to detect drift

### Memory Isolation

Verify brain mount compliance:
- Each agent's mounted brains must match what `access-policy.yaml` authorizes for its roles
- `neverAccessibleBy` entries must be enforced — an agent with a denied role must not have that brain mounted
- Report any unauthorized mounts as critical violations

### Separation of Duties

Check approval workflow integrity:
- No agent should be able to approve its own requests (unless break-glass conditions are met: CEO role, explicit reason, future expiry)
- Approval routing should direct requests to the correct role based on `approverRole` in the policy rule

### Additional Gap Categories (Org Mode)

| Category              | Description                                              | Typical Severity |
|-----------------------|----------------------------------------------------------|-----------------|
| `identity_spoofing`   | Token/agentId mismatch detected in audit trail           | critical        |
| `unauthorized_mount`  | Agent has brain mounted that access-policy.yaml denies   | critical        |
| `unknown_tool`        | Tool in use with no policy classification                | warning/critical |
| `self_approval`       | Agent approved its own request without break-glass       | critical        |
| `runtime_exposure`    | Agent process can reach unauthorized brain/credential    | warning         |

## Safety Guarantees

1. **Read-only**: Audit never modifies decisions, policies, or evidence
2. **Tenant-scoped**: Audit only accesses the requesting tenant's data
3. **No credential exposure**: Reports never contain secrets or credentials
4. **Severity-first**: Critical gaps are always presented first
5. **Actionable**: Every gap includes a specific recommendation
6. **Org-aware**: In org mode, identity, isolation, and separation-of-duties checks are included
