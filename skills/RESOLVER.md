# Decision Core — Skill Resolver

> **For agents:** Read this file first to find the right skill for a user's intent.
> Match the user's request against the Intent column, then read the file at Path.

## Routing Table

| Intent | Skill | Path |
|--------|-------|------|
| "set up decision core" | Onboarding | skills/onboard/SKILL.md |
| "onboard my agent" | Onboarding | skills/onboard/SKILL.md |
| "configure governance" | Onboarding | skills/onboard/SKILL.md |
| "new policy setup" | Onboarding | skills/onboard/SKILL.md |
| "write a policy" | Policy Author | skills/policy-author/SKILL.md |
| "create a policy" | Policy Author | skills/policy-author/SKILL.md |
| "add a rule" | Policy Author | skills/policy-author/SKILL.md |
| "convert policy document" | Policy Author | skills/policy-author/SKILL.md |
| "policy from document" | Policy Author | skills/policy-author/SKILL.md |
| "author policy" | Policy Author | skills/policy-author/SKILL.md |
| "audit my agent" | Compliance Audit | skills/audit/SKILL.md |
| "run audit" | Compliance Audit | skills/audit/SKILL.md |
| "check compliance" | Compliance Audit | skills/audit/SKILL.md |
| "find policy gaps" | Compliance Audit | skills/audit/SKILL.md |
| "governance gaps" | Compliance Audit | skills/audit/SKILL.md |
| "evidence integrity" | Compliance Audit | skills/audit/SKILL.md |
| "explain a decision" | SDK Method | Use `DecisionCore.explain(correlationId)` |
| "why was this blocked" | SDK Method | Use `DecisionCore.explain(correlationId)` |

## How to Read This File

1. **Match intent**: Compare the user's request to the Intent column. Use fuzzy matching — the phrases are examples, not exact requirements.
2. **Load skill**: Read the file at the resolved Path. It contains phases, questions, and tool calls.
3. **Execute skill**: Follow the instructions in the skill file step by step.

If the user's intent doesn't match any row, check whether it maps to a core SDK method (evaluate, explain) or CLI command (evaluate, audit, ingest, compile, serve, providers, explain, onboard, author).

## Skill Summaries

### Onboarding (`skills/onboard/SKILL.md`)

Guides the user through a 5-phase interview to configure Decision Core
governance. Produces structured onboarding output that feeds the active
`.decision-core/` policy set and runtime config. Use when the user is setting up
Decision Core for the first time or reconfiguring governance.

**Tools:** `dc_onboard_start`, `dc_onboard_answer`, `dc_onboard_generate`, `dc_onboard_validate`

### Policy Author (`skills/policy-author/SKILL.md`)

Converts natural language policy statements or documents into YAML policy rules. All generated rules are drafts (`enabled: false`) and require explicit user acceptance. Use when the user wants to add or create policy rules.

**Tools:** `dc_author_from_text`, `dc_author_from_document`, `dc_author_review`, `dc_author_commit`

### Compliance Audit (`skills/audit/SKILL.md`)

Reviews decision history, detects governance gaps (missing policies, broken evidence chains, bypassed approvals), and generates compliance reports. Read-only — never modifies state. Use when the user wants to check their governance posture.

**Tools:** `dc_audit_run`, `dc_audit_gaps`, `dc_audit_evidence`

## Prerequisites

- Decision Core package installed (`npm install @decision-core/core`)
- For MCP skills: MCP server running (`decision-core serve --mcp`)
- For CLI skills: `decision-core` binary available in PATH
