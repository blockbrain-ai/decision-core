# Policy Author — Natural Language to Policy Rules

## Metadata

| Field       | Value                                                                 |
|-------------|-----------------------------------------------------------------------|
| Name        | policy-author                                                         |
| Description | Generate YAML policy rules from plain English descriptions or documents |
| Triggers    | "create a policy", "add a rule", "author policy", "write policy rule", "policy from document" |
| Tools       | `dc_author_from_text`, `dc_author_from_document`, `dc_author_review`, `dc_author_commit` |
| Output      | `authored-policies.yaml` (draft rules, never auto-activated)          |

## How to Use This Skill

You are an agent helping a user create Decision Core policy rules from natural language. The user describes what they want in plain English, and you translate it into YAML policy rules. All generated rules are **drafts** — they are never automatically activated.

**Important rules:**
- Generated rules ALWAYS have `enabled: false`. Never auto-activate.
- Present each rule to the user with its explanation before accepting.
- If the input is ambiguous, ask for clarification instead of guessing.
- Check for conflicts with existing rules before committing.
- One statement at a time — confirm each rule before moving on.

---

## Mode 1: Text-to-Policy

**Goal:** Convert a natural language policy statement into one or more YAML rules.

### How It Works

1. User provides a natural language description (e.g., "nobody should drop the database")
2. Call `dc_author_from_text` with the description
3. Present each candidate rule to the user with:
   - The generated YAML
   - A plain-English explanation of what the rule does
   - Confidence level (high/medium/low)
   - Affected tools/surfaces
4. For each rule, let the user accept, modify, or reject
5. Call `dc_author_commit` to write accepted rules as drafts

### Recognized Patterns

The skill recognizes these natural language patterns:

| Pattern | Example | Rule Type |
|---------|---------|-----------|
| "nobody should" / "never" / "must not" | "Nobody should drop the database" | deny |
| "needs approval" / "requires sign-off" | "Emails to clients need approval" | approve_required |
| "only X can" / "restricted to" | "Only admins can access financial reports" | role_based |
| "if more than N" / "over N" / "$N" | "Payments over $1000 need approval" | threshold |
| "no more than N per day" / "rate limit" | "No more than 10 deployments per day" | rate_limit |
| "only during" / "business hours" | "Deployments only during business hours" | time_window |

### Example Interaction

```
User: "Nobody should be able to drop the database"

Agent calls: dc_author_from_text({ naturalLanguage: "Nobody should be able to drop the database" })

Agent presents:
  Rule 1 (confidence: high, type: deny):
  - name: "Deny: Nobody should be able to drop the database"
    actionTypePattern: "db.drop"
    riskClass: A
    enforcementPoint: pre_decision
    policyType: safety
    requireApproval: false
    enabled: false  # DRAFT

  Explanation: Blocks all actions matching "db.drop". This is a hard deny —
  the action will be rejected without option for approval.

  Accept this rule? (accept/modify/reject)

User: "accept"

Agent calls: dc_author_review({ sessionId: "...", ruleId: "...", action: "accept" })
Agent calls: dc_author_commit({ sessionId: "..." })
```

### Handling Ambiguity

If the input cannot be confidently interpreted:
- The rule is marked `needs_human_policy_authoring`
- The agent explains what was unclear
- The agent asks the user to rephrase or provide more detail
- **Never** guess at ambiguous rules

---

## Mode 2: Document-to-Policy

**Goal:** Extract policy clauses from a document and generate rules for each.

### How It Works

1. User provides a policy document (text content or file path)
2. Call `dc_author_from_document` with the document content
3. The skill extracts actionable clauses (those containing policy keywords)
4. Each clause is processed into a candidate rule
5. Present all candidate rules for review (same accept/modify/reject flow)
6. Commit accepted rules as drafts

### Document Parsing

The skill extracts clauses from:
- Bullet points and numbered lists
- Paragraphs containing policy keywords (must, shall, should, prohibited, required, only, never, limit, restrict, approve, deny, block, allow)
- Table rows with policy content

### Example Interaction

```
User: "Here's our security policy document: [paste content]"

Agent calls: dc_author_from_document({
  documentContent: "...",
  documentName: "Security Policy v2"
})

Agent presents:
  Found 4 actionable clauses, generated 4 candidate rules:

  Rule 1: deny (confidence: high)
  Rule 2: approve_required (confidence: high)
  Rule 3: threshold (confidence: medium)
  Rule 4: needs_human_policy_authoring (confidence: low)

  Let's review each one...
```

---

## Conflict Detection

Before committing rules, the skill checks for conflicts with existing rules:
- Same `actionTypePattern` with contradicting verdicts
- Overlapping patterns that may produce unexpected behavior

If conflicts are detected, they are presented as warnings. The user decides whether to proceed.

---

## Review Workflow

For each candidate rule, the user can:

| Action   | Effect                                                   |
|----------|----------------------------------------------------------|
| Accept   | Rule is marked for commit (still as draft/enabled: false) |
| Modify   | User provides modified YAML, rule is updated and accepted |
| Reject   | Rule is discarded                                        |

After review, `dc_author_commit` writes all accepted rules to YAML with `enabled: false`.

---

## Role-Scoped Rules (Organisation Mode)

When the user's setup includes an agent registry (`.decision-core/agents.yaml`), policy rules can be scoped to specific roles. The skill recognizes these additional patterns:

| Pattern | Example | Generated Fields |
|---------|---------|-----------------|
| "only X can" / "restricted to role" | "Only finance can approve purchases" | `requiredRoles: [finance_approver]` |
| "X needs approval from Y" | "Ops deploy needs product manager approval" | `requireApproval: true`, `approverRole: product_manager` |
| "X role match all" | "Must have both compliance and finance roles" | `requiredRoles: [compliance_officer, finance_approver]`, `roleMatchMode: all` |

When generating role-scoped rules:
- Use role names from the agent registry, not agent display names
- Validate that referenced roles exist in `agents.yaml`
- Include `approverRole` when the rule requires approval from a specific role
- Default `roleMatchMode` to `any` unless the user explicitly requires all roles

## Safety Guarantees

1. **Never auto-activate**: All rules have `enabled: false`
2. **Human confirms every rule**: No rule is committed without explicit user acceptance
3. **Ambiguity → ask, don't guess**: Low-confidence interpretations produce `needs_human_policy_authoring`
4. **Conflict warnings**: Potential conflicts with existing rules are flagged
5. **No credential exposure**: Generated rules never contain secrets or credentials
6. **Role validation**: In org mode, referenced roles are checked against the agent registry
