# MCP Server Integration Guide

Decision Core can run as an MCP server for onboarding, policy authoring, audit,
and core policy queries. This is the right path when you want an existing
agent, IDE, or MCP-capable client to drive Decision Core interactively.

## What `decision-core serve --mcp` starts

The CLI starts a **stdio MCP server**:

```bash
decision-core serve --mcp
```

This path does not start the HTTP API. It also does not add a separate auth
layer on top of stdio. Access control comes from the process boundary of the
client that launched it.

If you need the REST API for Hermes or other localhost bridges, run
`decision-core serve` without `--mcp` and use the HTTP guide instead.

## Client configuration

### Local install

```json
{
  "mcpServers": {
    "decision-core": {
      "command": "decision-core",
      "args": ["serve", "--mcp"]
    }
  }
}
```

### Package-on-demand with `npx`

```json
{
  "mcpServers": {
    "decision-core": {
      "command": "npx",
      "args": ["-y", "@decision-core/core", "serve", "--mcp"]
    }
  }
}
```

## Tool groups

### Core tools

- `evaluate`
- `query_policy`
- `list_policy_rules`
- `explain_decision`
- `audit_trail`
- `ingest_policy`
- `compile_rules`

### Onboarding interview tools

- `dc_onboard_start`
- `dc_onboard_answer`
- `dc_onboard_generate`
- `dc_onboard_validate`

### Agent-led setup tools

- `dc_setup_detect`
- `dc_setup_infer`
- `dc_setup_generate`
- `dc_setup_validate`
- `dc_setup_activate`

### Policy authoring tools

- `dc_author_from_text`
- `dc_author_from_document`
- `dc_author_review`
- `dc_author_commit`

### Audit workflow tools

- `dc_audit_run`
- `dc_audit_gaps`
- `dc_audit_evidence`

## Programmatic use

Decision Core also exports the MCP helpers:

```typescript
import { createMcpServer, startStdioServer } from '@decision-core/core';
```

`createMcpServer()` creates the MCP server instance with all bundled tools
registered. `startStdioServer()` connects that instance to stdio.

## Tool contracts

### `evaluate`

**Arguments**

```json
{
  "surfaceId": "mcp",
  "action": "finance.read_ledger",
  "context": {
    "agentId": "md-agent"
  }
}
```

**Result**

```json
{
  "verdict": "allow",
  "matchedPolicies": [
    {
      "ruleId": "rule-1",
      "ruleName": "allow-finance-ledger-read",
      "verdict": "allow",
      "reason": "Role and surface match"
    }
  ]
}
```

### `query_policy`

Supports the same filters as `GET /policy`:

- `policyType`
- `riskClass`
- `enforcementPoint`
- `enabled`
- `limit`
- `offset`

### `list_policy_rules`

Returns the current rules as clause-style entries with optional `limit` and
`offset`.

### `explain_decision`

Takes `correlationId` and returns the matching decision log records.

### `audit_trail`

Supports:

- `surface`
- `toolName`
- `status`
- `from`
- `to`
- `limit`
- `offset`

### `ingest_policy`

Creates a policy rule in the current MCP process:

```json
{
  "name": "Block destructive shell",
  "actionTypePattern": "shell.rm_*",
  "policyType": "safety",
  "priority": 100,
  "enabled": true
}
```

### `compile_rules`

Compiles approved clause IDs when a rule compiler is configured.

## Existing Hermes or OpenClaw installs

For agents that already exist, the MCP server is additive:

- keep the existing Hermes or OpenClaw runtime as-is
- add Decision Core as another MCP server
- point the client at the bundled skill file you want to use
- keep runtime enforcement plugins separate from the MCP skill flow

Do **not** put MCP tool names like `dc_onboard_start` into the Hermes
enforcement plugin config or the OpenClaw runtime hook manifest. Those files
govern tool interception, not MCP skill discovery.

## Failure semantics

- tool errors are returned as structured MCP tool responses
- the stdio server should be treated as fail-closed for `evaluate`
- onboarding and authoring flows can be retried safely after tool-level errors

## Related documentation

- [Onboarding](../ONBOARDING.md)
- [HTTP Integration](./http.md)
- [Hermes Integration](./hermes.md)
- [OpenClaw Integration](./openclaw.md)
