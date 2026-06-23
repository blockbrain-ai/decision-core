# Onboard — Decision Core Setup Interview

## Metadata

| Field       | Value                                              |
|-------------|----------------------------------------------------|
| Name        | onboard                                            |
| Description | Guide user through Decision Core setup via 5-phase interview |
| Triggers    | "set up decision core", "onboard", "configure governance", "new policy setup" |
| Tools       | `dc_onboard_start`, `dc_onboard_answer`, `dc_onboard_generate`, `dc_onboard_validate` |
| Output      | `policies.yaml`, `surfaces.yaml`, provider config  |

## How to Use This Skill

You are an agent helping a user set up Decision Core governance for their AI agent or tool. Read each phase below in order. Ask the user the listed questions, collect their answers, then move to the next phase. At the end, generate configuration files.

**Important rules:**
- Ask one phase at a time. Do not skip phases.
- Use the MCP tools listed above to process answers and generate config, or collect answers and pass them to the CLI.
- Default to the most restrictive option when the user is unsure.
- Never ask for API keys or secrets directly — only ask which env var name holds the key.
- If the user already has Hermes, OpenClaw, G-Brain, or another memory system,
  keep that installation in place and generate Decision Core around it rather
  than asking them to rebuild the host from scratch.

---

## Phase 1: Agent Discovery

**Goal:** Understand what the agent does and what tools it has access to.

### Questions

1. **agent_description** (text): "What does your agent do? Describe its purpose in one or two sentences."
2. **agent_tools** (text): "List the tools or capabilities your agent has access to (e.g., file.read, file.write, web.search, deploy.production, db.query, email.send). Comma-separated."
3. **data_access** (multi_select): "What types of data does your agent access?"
   - Options: `public_data`, `internal_docs`, `user_pii`, `financial_records`, `source_code`, `credentials`, `none`
4. **environment** (select): "Where does this agent run?"
   - Options: `local_dev`, `staging`, `production`, `ci_cd`

### Interpretation

- More tools = more policy rules needed
- `user_pii`, `financial_records`, `credentials` data access → higher risk classification
- `production` environment → stricter defaults

---

## Phase 2: Risk Assessment

**Goal:** Classify each tool by risk level and identify sensitive data flows.

### Questions

1. **high_risk_tools** (multi_select): "Which of your tools could cause irreversible changes or access sensitive data? Select from your tool list."
   - Options: populated from Phase 1 `agent_tools` answer
2. **medium_risk_tools** (multi_select): "Which tools modify state but are generally reversible?"
   - Options: remaining tools from Phase 1
3. **external_services** (confirm): "Does your agent call external APIs or third-party services?"
4. **can_spend_money** (confirm): "Can any tool trigger financial transactions or incur costs?"
5. **pii_handling** (confirm): "Does your agent process or store personally identifiable information (PII)?"

### Interpretation

- High-risk tools → Risk Class A, `requireApproval: true`
- Medium-risk tools → Risk Class B, standard enforcement
- Remaining tools → Risk Class C, lightweight monitoring
- External services → add `action_dispatch` enforcement point
- Financial capability → add `maxAmountUsd` constraints
- PII handling → add `compliance` policy type rules

---

## Phase 3: Governance Posture

**Goal:** Determine the overall strictness level based on team and compliance needs.

### Questions

1. **risk_profile** (select): "What governance profile fits your use case?"
   - `personal` — Solo developer, fast iteration, minimal approval gates
   - `team` — Small team, peer review for risky actions, audit trail
   - `enterprise` — Regulated environment, mandatory approvals, full compliance
2. **team_size** (select): "How many people use or oversee this agent?"
   - `solo` (1 person)
   - `small` (2-10)
   - `large` (11+)
3. **compliance_requirements** (multi_select): "Which compliance standards apply?"
   - Options: `none`, `sox`, `gdpr`, `hipaa`, `pci_dss`, `iso_27001`, `internal_policy`
4. **approval_workflow** (select): "How should high-risk actions be handled?"
   - `block` — Deny high-risk actions entirely
   - `approve` — Require human approval before execution
   - `log_only` — Allow but log for audit

### Interpretation

- `personal` → fewer rules, wider allow ranges, `log_only` default
- `team` → moderate rules, `approve` for Class A
- `enterprise` → comprehensive rules, `block` or `approve` for Class A and B
- Compliance standards add specific policy rules (e.g., GDPR → PII controls)

---

## Phase 4: Provider Selection

**Goal:** Choose how the agent connects to model/decision providers.

### Questions

1. **provider_mode** (select): "How should Decision Core connect to AI model providers?"
   - `host` — The host agent provides model access (recommended for MCP-connected agents)
   - `disabled` — No model provider; policy-only mode (deterministic decisions only)
   - `direct` — Decision Core calls the provider API directly
   - `local` — Use a local model (Ollama, llama.cpp, etc.)
2. **api_key_env_var** (text, conditional on `direct`): "What environment variable holds your API key? (e.g., ANTHROPIC_API_KEY). Do NOT enter the key itself."
3. **local_endpoint** (text, conditional on `local`): "What is your local model endpoint? (e.g., http://localhost:11434)"

### Interpretation

- `host` → minimal provider config, relies on host agent
- `disabled` → no provider block, safest default
- `direct` → needs env var reference (never the actual key)
- `local` → needs endpoint URL

---

## Phase 5: Configuration Generation

**Goal:** Generate the final configuration files from all collected answers.

### Process

1. Call `dc_onboard_generate` (or `decision-core onboard --generate`) with all answers from phases 1-4.
2. The tool returns three config files:

#### policies.yaml
Generated rules based on:
- One rule per high-risk tool → Risk Class A, enforcement at `pre_decision`
- One rule per medium-risk tool → Risk Class B, enforcement at `action_dispatch`
- One catch-all rule for low-risk tools → Risk Class C, `post_execution`
- Compliance-specific rules if standards were selected
- Financial constraints if spending capability was declared

#### surfaces.yaml
Generated surface bindings based on:
- Each tool mapped to appropriate trust tier
- Environment-specific surface configuration
- High-risk tools on restricted surfaces, low-risk on open surfaces

#### provider config (embedded in decision-core.yaml)
Generated provider block based on Phase 4 answers.

3. Call `dc_onboard_validate` to verify the generated config is valid.
4. Present the generated config to the user for review.
5. **Do not activate the config automatically.** The user must explicitly save and apply it.

---

## Example Output: Personal Profile

```yaml
# policies.yaml
version: "1.0.0"
rules:
  - name: "Monitor file writes"
    actionTypePattern: "file.write"
    riskClass: C
    enforcementPoint: post_execution
    policyType: safety
    requireApproval: false
    enabled: true
  - name: "Log web searches"
    actionTypePattern: "web.search"
    riskClass: C
    enforcementPoint: post_execution
    policyType: business
    requireApproval: false
    enabled: true
```

## Example Output: Team Profile

```yaml
# policies.yaml
version: "1.0.0"
rules:
  - name: "Approve production deploys"
    actionTypePattern: "deploy.production"
    riskClass: A
    enforcementPoint: pre_decision
    policyType: safety
    requireApproval: true
    enabled: true
  - name: "Review database mutations"
    actionTypePattern: "db.write"
    riskClass: B
    enforcementPoint: action_dispatch
    policyType: compliance
    requireApproval: false
    enabled: true
  - name: "Monitor reads"
    actionTypePattern: "*.read"
    riskClass: C
    enforcementPoint: post_execution
    policyType: business
    requireApproval: false
    enabled: true
```

## Example Output: Enterprise Profile

```yaml
# policies.yaml
version: "1.0.0"
rules:
  - name: "Block unapproved deploys"
    actionTypePattern: "deploy.*"
    riskClass: A
    enforcementPoint: pre_decision
    policyType: safety
    requireApproval: true
    enabled: true
  - name: "Approve financial transactions"
    actionTypePattern: "payment.*"
    riskClass: A
    enforcementPoint: pre_decision
    policyType: compliance
    maxAmountUsd: 1000
    requireApproval: true
    enabled: true
  - name: "Audit all data access"
    actionTypePattern: "data.*"
    riskClass: B
    enforcementPoint: action_dispatch
    policyType: compliance
    requireApproval: false
    enabled: true
  - name: "Monitor all other actions"
    actionTypePattern: "*"
    riskClass: C
    enforcementPoint: post_execution
    policyType: business
    requireApproval: false
    enabled: true
```
