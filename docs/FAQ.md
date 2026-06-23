# FAQ

Frequently asked questions about Decision Core.

## General

### Why was my tool blocked?

Decision Core blocked the tool because a policy rule with `action: deny` matched the action. To diagnose:

```bash
# Check which rules matched
decision-core evaluate --surface <surface> --action <action>
```

Or use the explain API:

```typescript
const explanation = await dc.explain(result.correlationId);
// Shows: matchedPolicies, verdict, autonomyMode, rulesFired
```

Common reasons:
- A deny rule matches the tool's glob pattern (e.g., `delete_*` matches `delete_file`)
- The action triggered a `safe_block` because no surface binding exists
- A condition was violated (amount exceeded, outside time window)

### How do I add a new tool to my policy?

Add a rule to your policy pack YAML:

```yaml
rules:
  - name: allow-my-new-tool
    description: Allow my custom tool
    action: allow
    surfaces: ["*"]
    tools: ["my_tool_name"]
    priority: 10
```

Or create the rule programmatically:

```typescript
await policyRuleRepo.create(tenantId, {
  name: 'allow-my-tool',
  actionType: 'my_tool_name',
  verdict: 'allow',
  policyType: 'business',
  riskClass: 'C',
  enforcementPoint: 'pre_decision',
  priority: 10,
  enabled: true,
});
```

Remember: if a deny rule also matches this tool, deny-wins — the tool will still be blocked.

### Can I use Decision Core without an LLM?

Yes. Set provider mode to `disabled`:

```typescript
const dc = await quickStart({
  providerMode: 'disabled',
  profile: 'personal',
});
```

In this mode:
- Deterministic routing still works (compiled rules, glob matching)
- Model-assisted patterns return `safe_block` instead of calling a model
- Policy evaluation (PDP) is fully functional (no model needed)
- Evidence chains are still recorded

This is ideal for CI pipelines, testing, and deterministic-only deployments.

### What's the difference between a rule and a clause?

**Rules** are the runtime enforcement mechanism — they have an action (`allow`/`deny`/`approve_required`), match patterns, and are evaluated by the PDP.

**Clauses** are the formal policy statements from which rules are derived. Clauses have types (obligation, prohibition, etc.), belong to a versioned graph, and can be compiled into rules.

Think of it as: clauses are the *policy source code*, rules are the *compiled output*.

```
Policy Document → Clauses (typed, versioned, graph) → Compiled Rule Set → Rules (runtime)
```

### How do I migrate from another guardrails system?

1. **Map your existing rules** to Decision Core's format:
   - Deny rules → `action: deny` with glob patterns
   - Allow lists → `action: allow` with specific tool patterns
   - Approval workflows → `action: approve_required`

2. **Start in advisory mode** (autonomy level 4-5) to observe without blocking:
   ```typescript
   const result = await pep.enforce(tenantId, 'pre_decision', action, {
     autonomyLevel: 5, // advisory — logs only
   });
   ```

3. **Review decision logs** to confirm rules match expected behavior.

4. **Lower autonomy level** progressively: 5 → 3 → 1 → 0.

5. **Enable persistence** (SQLite) for production audit trails.

## Policy

### How does deny-wins work in practice?

If **any** matching rule returns `deny`, the final verdict is `deny`. No amount of allow rules can override it.

```
allow (priority 100) + allow (priority 50) + deny (priority 1) = DENY
```

Priority does not affect deny-wins — it only determines reporting order. To allow something that's currently denied, you must remove or disable the deny rule.

### Can I have different policies per environment?

Yes. Use different tenants or different policy packs:

```typescript
// Production: strict
const prodDc = await quickStart({ tenantId: 'prod', profile: 'enterprise' });

// Staging: permissive
const stageDc = await quickStart({ tenantId: 'staging', profile: 'team' });

// Development: advisory
const devDc = await quickStart({ tenantId: 'dev', profile: 'personal' });
```

### What happens when no rules match an action?

Behavior depends on your policy pack:
- **Default packs** include a catch-all rule (e.g., `allow` all in personal, `deny` unknown in enterprise)
- **Without catch-all:** The PDP returns `allow` (no deny rule fired), but the action may still be safe-blocked by routing if no surface binding exists

Best practice: always include an explicit catch-all rule to make the default behavior intentional.

### How do time windows work?

Time windows restrict when a rule applies:

```yaml
conditions:
  timeWindowStart: "09:00"  # UTC
  timeWindowEnd: "17:00"    # UTC
```

The rule only fires during the window. Outside the window, the rule is skipped (not evaluated). This means a deny rule with a time window only blocks during that window.

## Routing

### When does Decision Core call the model?

Only when all of these are true:
1. Provider mode is not `disabled`
2. The surface binding specifies a model-assisted pattern
3. Deterministic evaluation did not produce a high-confidence result
4. The route class is not `deterministic_only` or `not_ready_data_or_policy_gap`

If any condition fails, the decision uses either the deterministic result or safe_block.

### What is safe_block?

`safe_block` is a fail-closed verdict. It means Decision Core could not evaluate the action (missing binding, provider down, policy gap) and defaulted to blocking.

Safe-block is different from deny:
- `deny`: A rule explicitly prohibits the action
- `safe_block`: No rule could evaluate it; blocked by safety default

If you're seeing unexpected safe_blocks, check:
1. Is the surface registered in the trust suite?
2. Is the provider configured and reachable?
3. Does your route config cover this surface?

### How do I make a surface deterministic-only?

Configure the route class:

```json
{
  "routes": {
    "my-surface": {
      "routeClass": "deterministic_only",
      "confidenceThreshold": 0.7
    }
  }
}
```

Or in the trust suite, set the review mode to `none` or `autonomous` with no model-assisted pattern.

## Evidence & Audit

### How long are evidence chains retained?

Depends on your persistence implementation:
- **In-memory:** Cleared when the process exits
- **SQLite:** Retained until explicitly deleted
- **Custom:** Per your implementation's retention policy

For compliance, persist evidence to durable storage and configure retention per your regulatory requirements.

### Can I export evidence for external audit?

Yes. Query the evidence chain and serialize:

```typescript
const chain = await evidenceChainService.getChain(tenantId, correlationId);
const json = JSON.stringify(chain.records, null, 2);
// Write to external audit system
```

The chain includes all information needed for independent verification (hashes, sequences, payloads).

### What triggers a chain verification failure?

- A record's stored `auditHash` doesn't match the recomputed hash (content modified)
- A record's `previousHash` doesn't match the prior record's `auditHash` (record inserted/removed)
- The sequence numbers have gaps (record deleted)

Any of these indicates either a bug in persistence or intentional tampering.

## Integration

### Which integration should I use?

| Scenario | Integration |
|----------|-------------|
| Embedded in a TypeScript app | [SDK](./INTEGRATION-GUIDES/) |
| IDE or AI agent with MCP | [MCP](./INTEGRATION-GUIDES/mcp.md) |
| Language-agnostic API | [HTTP](./INTEGRATION-GUIDES/http.md) |
| Hermes Agent framework | [Hermes plugin](./INTEGRATION-GUIDES/hermes.md) |
| OpenCLAW agent framework | [OpenCLAW plugin](./INTEGRATION-GUIDES/openclaw.md) |
| G-Brain knowledge system | [G-Brain adapter](./INTEGRATION-GUIDES/gbrain.md) |

### Can I use multiple surfaces simultaneously?

Yes. A single Decision Core instance can serve requests from SDK, MCP, HTTP, and CLI simultaneously. Each surface is independent and evaluated against the same policy rules (scoped by tenant).

### Do I need a database?

No. Decision Core defaults to in-memory persistence with zero external dependencies. Use SQLite for persistent audit trails, or implement a custom repository for your preferred database.

## Troubleshooting

### "No surface binding found" error

The surface ID in your request doesn't match any configured surface binding. Fix by:
1. Checking `config/trust-suite/surface-bindings.json` for available surfaces
2. Adding a binding for your surface
3. Using a registered surface ID in your request

### "Provider unavailable" with safe_block

The model provider couldn't be reached. Check:
1. Provider mode is correctly set (not `disabled` if you need model calls)
2. API key is configured in environment
3. Provider endpoint is reachable
4. Run `decision-core providers doctor` for diagnostics

### Decision takes too long

Check:
1. Is the tribunal pattern configured with too many assessors?
2. Is the model provider experiencing high latency?
3. Consider lowering the confidence threshold to accept more deterministic results
4. Use `deterministic_only` route class for time-sensitive surfaces

## Related Documentation

- [Architecture](./ARCHITECTURE.md) — System overview
- [Policy Authoring Guide](./POLICY-AUTHORING-GUIDE.md) — Rule writing details
- [Trust Routing Guide](./TRUST-ROUTING-GUIDE.md) — Routing configuration
- [Security](./SECURITY.md) — Security guarantees
- [Integration Guides](./INTEGRATION-GUIDES/) — Setup per integration
