# Integration Contracts

> Verified against current source on 2026-05-20.

This document defines the current Decision Core integration contracts for the
surfaces that matter in production: SDK, Hermes, OpenClaw, MCP, HTTP, CLI, and
G-Brain evidence write-back.

## 1. TypeScript SDK

The SDK is the source of truth. Every other surface delegates to it directly or
through a thin transport layer.

### `evaluate(input, options?)`

```typescript
import { evaluate } from '@blockbrainlabs/decision-core';

const result = await evaluate({
  action: 'finance.read_ledger',
  surface: 'hermes',
  context: { agentId: 'md-agent' },
});
```

**Input**

```typescript
interface EvaluateInput {
  action: string;
  surface?: string;
  context?: Record<string, unknown>;
}
```

**Output**

```typescript
interface EvaluateResult {
  decision: 'allow' | 'deny' | 'approve_required';
  matchedPolicies: Array<{
    ruleId: string;
    ruleName: string;
    verdict: string;
    reason: string;
  }>;
  rationale: string;
  correlationId: string;
}
```

### `createPolicyGuard(config?)`

`createPolicyGuard()` is the lightweight pre-tool decision surface used by the
OpenClaw plugin and by some CLI helpers.

It accepts:

- `tenantId`
- `policyPackPath`
- `denyUnknownDefault`
- `agentRegistryPath`

It returns:

```typescript
interface PolicyGuard {
  evaluate(
    tenantId: string,
    surfaceId: string,
    action: string,
    context?: Record<string, unknown>,
  ): Promise<{
    verdict: 'allow' | 'deny' | 'approve_required';
    matchedPolicies: Array<{
      ruleId: string;
      ruleName: string;
      verdict: string;
      reason: string;
    }>;
  }>;
}
```

### Fail mode

- configuration errors throw
- deny-unknown only applies when enabled by the loaded pack or explicit option

### Credential boundary

- no network credentials cross the SDK boundary
- caller identity is provided through `context`

## 2. Hermes plugin

Hermes uses the localhost HTTP bridge. The plugin lives in
`integrations/hermes/`.

### Config source

The plugin reads from Hermes `config.yaml` via `load_config()` under:

```yaml
plugins:
  enabled:
    - decision-core
  settings:
    decision-core:
      dc_base_url: "http://127.0.0.1:3100"
      dc_api_key: "<token>"
      dc_surface_id: "hermes"
      dc_fail_mode: "closed"
      dc_timeout_seconds: 5
      dc_agent_id: "md-agent"
```

### `pre_tool_call`

Hermes plugin -> Decision Core HTTP:

```json
{
  "surfaceId": "hermes",
  "action": "finance.read_ledger",
  "agentId": "md-agent",
  "context": {
    "args": { "period": "2026-Q2" }
  }
}
```

Decision Core verdict -> Hermes hook result:

- `allow` -> `{"action": "pass"}`
- `deny` -> `{"action": "block", "message": "..."}`
- `approve_required` -> `{"action": "block", "message": "Approval required: ..."}`

### `post_tool_call`

Hermes plugin -> Decision Core HTTP:

```json
{
  "surface": "hermes",
  "toolName": "finance.read_ledger",
  "result": { "rows": 3 },
  "timing_ms": 42,
  "correlationId": "0196ef8d-d6bc-7b2a-b0ad-5f1c2d6a6b0d"
}
```

Route:

- `POST /record-execution`

The legacy `POST /record` route is query-only and must not be used for
post-tool audit writes.

### Fail mode

- `dc_fail_mode: closed` blocks if the bridge is unavailable
- `dc_fail_mode: open` logs and allows

### Credential boundary

- Hermes keeps its own provider keys and session state
- Decision Core only sees the Decision Core bearer token and the payload sent by
  the plugin

## 3. OpenClaw integration module

OpenClaw uses the SDK directly. The proven integration surface is the
Decision Core OpenClaw hook module:

- source companion: `integrations/openclaw/`
- packaged runtime: `dist/integrations/openclaw/`

This is not yet documented as a native `openclaw plugins install
@blockbrainlabs/decision-core` package root.

### Config

Supported plugin config:

- `policyPackPath`
- `agentRegistryPath`
- `tenantId`
- `surfaceId`
- `failMode`
- `approvalTimeoutMs`

Runtime-only injection:

- `evidenceSink`

### `before_tool_call`

OpenClaw plugin input:

```typescript
{
  toolName: string;
  params?: Record<string, unknown>;
}
```

The plugin evaluates with `createPolicyGuard()` and maps verdicts to:

- `allow` -> `{ pass: true }`
- `deny` -> `{ block: true, blockReason: string }`
- `approve_required` -> `{ requireApproval: { ... } }`

### `after_tool_call`

The plugin records audit entries and, when configured, execution evidence via
the injected `DecisionEvidenceSink`.

### Fail mode

- `failMode: 'closed'` -> block on evaluation failure
- `failMode: 'open'` -> pass through on evaluation failure

## 4. G-Brain adapter contract

Decision Core integrates with G-Brain through a transport-backed client.

### Core types

```typescript
new GBrainClient({ transport, slugPrefix? });
new GBrainHttpTransport({ baseUrl, clientId, clientSecret });
new GBrainCliTransport({ binPath, cwd? });
new GBrainStoreAdapter({ client });
new GBrainDecisionEvidenceSink(store);
```

### Write namespace

Decision Core writes under the `decisions/` slug prefix.

### Transport selection in `decision-core serve`

- HTTP transport when all of these are set:
  - `DECISION_CORE_GBRAIN_URL`
  - `DECISION_CORE_GBRAIN_CLIENT_ID`
  - `DECISION_CORE_GBRAIN_CLIENT_SECRET`
- CLI transport when `DECISION_CORE_GBRAIN_BIN` is set

Set:

```bash
DECISION_CORE_EVIDENCE_SINK=gbrain
```

to activate the G-Brain evidence sink.

## 5. MCP server

`decision-core serve --mcp` starts a **stdio** MCP server.

### Core tool names

- `evaluate`
- `query_policy`
- `list_policy_rules`
- `explain_decision`
- `audit_trail`
- `ingest_policy`
- `compile_rules`

### Bundled workflow tool names

- onboarding: `dc_onboard_*`
- setup: `dc_setup_*`
- authoring: `dc_author_*`
- audit: `dc_audit_*`

### Fail mode

- `evaluate` should be treated as fail-closed by the client
- tool-level errors are returned as MCP tool responses rather than crashing the
  server

### Credential boundary

- stdio mode inherits the launching process boundary
- there is no separate `DECISION_CORE_MCP_AUTH_TOKEN` path on the CLI stdio
  server

## 6. HTTP API

`decision-core serve` starts the localhost HTTP API.

### Endpoints

- `GET /health`
- `POST /evaluate`
- `POST /record`
- `POST /record-execution`
- `GET /policy`
- `GET /clauses`
- `GET /audit`
- org mode only:
  - `GET /org/report`
  - `GET /agents`
  - `GET /access-policy`

### Auth

- standard mode: `Authorization: Bearer <token>`
- org mode: per-agent bearer token
- `GET /health` is unauthenticated
- `X-API-Key` is not supported

### Org-mode identity contract

In org mode:

- the token resolves to `{ agentId, tenantId, roles }`
- request-body `agentId` is optional and revalidated when present
- mismatches return `403`

### Fail mode

- callers must treat `/evaluate` failures as fail-closed
- `/record-execution` is best-effort and can return `recorded: false`

## 7. CLI

The public CLI binary is:

```text
decision-core
```

### Commands used in the current working process

- `decision-core setup`
- `decision-core doctor`
- `decision-core evaluate --surface <id> --action <action>`
- `decision-core serve`
- `decision-core serve --mcp`
- `decision-core org init`
- `decision-core provision`
- `decision-core provision --verify`
- `decision-core org report`

### Notable behavior

- `decision-core serve --mcp` bypasses HTTP auth checks because it starts the
  stdio MCP server instead of HTTP
- `decision-core org init` copies bundled templates from the packaged `config/`
  directory
- `decision-core setup --dry-run --json` is the recommended inspection step for
  existing Hermes or G-Brain deployments

## 8. Existing deployments

For users who already have Hermes and G-Brain:

- keep the existing Hermes home and plugin layout
- keep the existing G-Brain data store
- add Decision Core around the existing runtime
- prefer G-Brain HTTP transport for evidence write-back
- start with `decision-core setup --dry-run --json` before activating anything

## Related documentation

- [HTTP Integration Guide](./INTEGRATION-GUIDES/http.md)
- [MCP Integration Guide](./INTEGRATION-GUIDES/mcp.md)
- [Hermes Integration Guide](./INTEGRATION-GUIDES/hermes.md)
- [OpenClaw Integration Guide](./INTEGRATION-GUIDES/openclaw.md)
- [G-Brain Integration Guide](./INTEGRATION-GUIDES/gbrain.md)
