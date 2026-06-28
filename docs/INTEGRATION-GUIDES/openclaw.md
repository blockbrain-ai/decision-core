# OpenClaw Integration Guide

> **Status: EXPERIMENTAL (v0.1).** The hook contract below is aligned with
> OpenClaw's real plugin API (`src/plugins/hook-types.ts` and `types.ts`):
> the `before_tool_call`/`after_tool_call` event shapes, the
> `info | warning | critical` severity enum, and the
> `allow-once | allow-always | deny | timeout | cancelled` approval-resolution
> enum. Unlike the **Hermes** integration — proven end to end through Hermes's
> real tool-dispatch path (see `test/hermes-dropin-e2e/`) — the OpenClaw path
> has **not yet been verified through a full OpenClaw agent loop**. Run it
> behind `failMode: 'closed'` and validate in your own host before relying on
> it. Hermes is the recommended integration for v0.1.

Decision Core ships an OpenClaw integration module that evaluates tool calls
before they run and records audit evidence after they complete.

## Integration model

Decision Core exports an OpenClaw plugin definition with a `register(api)`
function (the real loader shape) that wires the hooks via
`api.registerHook('before_tool_call' | 'after_tool_call', ...)`. It also
exports `definePluginEntry(config)` returning a hook bundle for tests and for
hosts that wire the hooks themselves. Decision Core does **not** yet publish a
standalone native OpenClaw package layout for
`openclaw plugins install @blockbrainlabs/decision-core`.

```
OpenClaw before_tool_call -> Decision Core PolicyGuard -> pass | block | requireApproval
OpenClaw after_tool_call  -> audit sink / evidence sink
```

This means you keep your existing OpenClaw runtime and wire Decision Core's
hook handlers into that host/plugin layer.

## What the integration does

- loads a policy pack with `createPolicyGuard()`
- evaluates each tool call in `before_tool_call`
- maps Decision Core verdicts to OpenClaw hook results
- records approval resolutions through `ApprovalBridge`
- optionally writes evaluation and execution evidence through a
  `DecisionEvidenceSink`

## Module locations

Repo checkout:

```text
integrations/openclaw/
```

Published package runtime:

```text
dist/integrations/openclaw/
```

Published package source companion:

```text
integrations/openclaw/
```

The companion `integrations/openclaw/openclaw.plugin.json` is descriptive
config metadata for this integration. It is **not** a complete package-root
native OpenClaw installer manifest.

## Configuration

Static config keys:

- `policyPackPath`
- `agentRegistryPath`
- `tenantId`
- `surfaceId`
- `failMode` (`closed` or `open`)
- `approvalTimeoutMs`

Runtime-only injection:

- `evidenceSink`

## Verdict mapping

### Allow

Decision Core:

```json
{
  "verdict": "allow"
}
```

OpenClaw hook result:

```json
{
  "pass": true
}
```

### Deny

Decision Core:

```json
{
  "verdict": "deny",
  "matchedPolicies": [
    {
      "reason": "finance data is restricted to finance_approver"
    }
  ]
}
```

OpenClaw hook result:

```json
{
  "block": true,
  "blockReason": "finance data is restricted to finance_approver"
}
```

### Approval required

Decision Core:

```json
{
  "verdict": "approve_required"
}
```

OpenClaw hook result:

```json
{
  "requireApproval": {
    "title": "Approval required: finance.approve_purchase",
    "description": "manual approval needed",
    "severity": "medium",
    "timeoutMs": 300000,
    "timeoutBehavior": "deny"
  }
}
```

`requireApproval.onResolution()` records the approval outcome through the
plugin's `ApprovalBridge`.

## Failure modes

- `failMode: "closed"` blocks the tool call if policy evaluation throws
- `failMode: "open"` lets the tool call pass through on evaluation failure

For production, use `closed`.

## Evidence recording

The plugin can write:

- evaluation evidence in `before_tool_call`
- execution evidence in `after_tool_call`

This requires an injected `DecisionEvidenceSink`, for example a
`GBrainDecisionEvidenceSink`.

Without an evidence sink, policy enforcement still works, but write-back is not
performed.

## Org mode

If you provide `agentRegistryPath`, `createPolicyGuard()` can resolve roles for
`agentId` values passed in the hook context. This is how role-scoped
`requiredRoles` rules are enforced in OpenClaw-hosted multi-agent setups.

## Existing OpenClaw installs

For an existing OpenClaw workspace:

1. keep the current OpenClaw project and provider setup
2. wire Decision Core's OpenClaw integration module into the existing
   OpenClaw hook/plugin layer
3. point the integration at the Decision Core policy pack you generated with
   `decision-core setup` or `decision-core org init`
4. if you already have G-Brain, reuse it as the evidence sink instead of
   creating a second memory system

Do not document this path as `openclaw plugins install @blockbrainlabs/decision-core`
until Decision Core ships a native OpenClaw package root with the required
`package.json openclaw.extensions` metadata and compiled runtime layout.

## Related documentation

- [Onboarding](../ONBOARDING.md)
- [HTTP Integration](./http.md)
- [MCP Server Integration](./mcp.md)
- [Hermes Integration](./hermes.md)
