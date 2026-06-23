# HTTP API Integration Guide

Decision Core exposes a small localhost HTTP surface for host frameworks that
cannot embed the TypeScript SDK directly. This is the path used by the Hermes
plugin and by multi-agent org-mode deployments.

## What the HTTP server does

- evaluates an action before execution with `POST /evaluate`
- records post-tool execution evidence with `POST /record-execution`
- exposes read-only audit and policy queries
- enforces bearer-token auth, or per-agent token auth in org mode

It does **not** expose a public write API for rules or clauses. Rule authoring
stays in the SDK, CLI, or MCP tool layer.

## Start the server

### Standard bearer-token mode

```bash
DECISION_CORE_BEARER_TOKEN=<token> decision-core serve --host 127.0.0.1 --port 3100
```

### Local development only

```bash
decision-core serve --host 127.0.0.1 --port 3100 --allow-unauthenticated-local
```

`--allow-unauthenticated-local` is rejected for non-localhost bindings.

### Org mode

Org mode replaces the single global token with per-agent bearer tokens:

```bash
decision-core serve \
  --host 127.0.0.1 \
  --port 3100 \
  --agent-registry .decision-core/agents.yaml \
  --agent-auth .decision-core/agent-auth.yaml \
  --access-policy .decision-core/access-policy.yaml
```

If `.decision-core/agents.yaml` exists without `.decision-core/agent-auth.yaml`,
the server refuses to start. Run `decision-core provision` first.

## Authentication

### Standard mode

All endpoints except `GET /health` require:

```http
Authorization: Bearer <token>
```

The server does **not** support `X-API-Key`.

### Org mode

All protected endpoints require a per-agent bearer token. The server resolves
the caller identity from the token and uses that identity for policy checks.

If a request body also contains `agentId`, it is treated as an assertion and is
revalidated against the token-bound identity. Mismatches return `403`.

## Endpoint reference

### `GET /health`

No auth required.

**Response**

```json
{
  "status": "ok",
  "data": {
    "service": "decision-core",
    "timestamp": "2026-05-20T03:00:00.000Z"
  }
}
```

### `POST /evaluate`

Evaluate an action before execution.

**Request**

```json
{
  "surfaceId": "hermes",
  "action": "finance.read_ledger",
  "context": {
    "args": { "period": "2026-Q2" }
  }
}
```

**Response**

```json
{
  "status": "ok",
  "data": {
    "verdict": "allow",
    "matchedPolicies": [
      {
        "ruleId": "rule-1",
        "ruleName": "allow-finance-ledger-read",
        "verdict": "allow",
        "reason": "Role and surface match"
      }
    ],
    "correlationId": "0196ef8d-d6bc-7b2a-b0ad-5f1c2d6a6b0d"
  }
}
```

**Validation failure**

```json
{
  "error": "Missing required fields: surfaceId, action",
  "code": "INVALID_REQUEST"
}
```

Notes:

- the server generates `correlationId`
- in org mode, token-bound `agentId` and `callerRoles` are injected into
  `context`
- if an evidence sink is configured, evaluation evidence is recorded
  fire-and-forget

### `POST /record-execution`

Record post-tool execution evidence.

**Request**

```json
{
  "surface": "hermes",
  "toolName": "finance.read_ledger",
  "result": { "rows": 3 },
  "timing_ms": 42,
  "correlationId": "0196ef8d-d6bc-7b2a-b0ad-5f1c2d6a6b0d"
}
```

`surfaceId` and `timingMs` are also accepted. The server normalizes both forms.

**Response with sink configured**

```json
{
  "status": "ok",
  "data": {
    "recorded": true,
    "correlationId": "0196ef8d-d6bc-7b2a-b0ad-5f1c2d6a6b0d"
  }
}
```

**Response without sink configured**

```json
{
  "status": "ok",
  "data": {
    "recorded": false,
    "reason": "no evidence sink configured"
  }
}
```

This endpoint is best-effort by design. It must never change the policy verdict
that was already returned by `/evaluate`.

### `POST /record`

Read decision log records. Despite the name, this endpoint is query-only.

**Request by correlation ID**

```json
{
  "correlationId": "0196ef8d-d6bc-7b2a-b0ad-5f1c2d6a6b0d"
}
```

**Request with filters**

```json
{
  "surface": "hermes",
  "toolName": "finance.read_ledger",
  "status": ["generated", "blocked"],
  "limit": 20,
  "offset": 0
}
```

**Response**

```json
{
  "status": "ok",
  "data": {
    "records": [],
    "count": 0
  }
}
```

In org mode, `/record` requires an audit-capable role such as `ceo`, `owner`,
`operator`, `admin`, `auditor`, or `compliance_officer`.

### `GET /policy`

Read policy rules.

Supported query parameters:

- `policyType`
- `riskClass`
- `enforcementPoint`
- `enabled`
- `limit`
- `offset`

**Example**

```bash
curl -s "http://127.0.0.1:3100/policy?enabled=true" \
  -H "Authorization: Bearer <token>"
```

### `GET /clauses`

Read the current tenant's rules in clause-style list form.

Supported query parameters:

- `limit`
- `offset`

### `GET /audit`

Read decision log entries.

Supported query parameters:

- `surface`
- `toolName`
- `status` as a comma-separated list
- `from`
- `to`
- `limit`
- `offset`

### Org-only endpoints

- `GET /org/report`
- `GET /agents`
- `GET /access-policy`

These endpoints are only enabled when the server is running in org mode and
require an operator-capable role.

## Existing Hermes + G-Brain deployments

If Hermes and G-Brain are already installed, you do **not** need to reinstall
either one to use the HTTP server:

1. keep the existing Hermes home, plugins, and G-Brain data store
2. start Decision Core HTTP on localhost
3. point the Hermes Decision Core plugin at `http://127.0.0.1:3100`
4. configure the G-Brain evidence sink on the Decision Core service

Recommended evidence transport:

```bash
DECISION_CORE_EVIDENCE_SINK=gbrain
DECISION_CORE_GBRAIN_URL=http://127.0.0.1:3131
DECISION_CORE_GBRAIN_CLIENT_ID=<client-id>
DECISION_CORE_GBRAIN_CLIENT_SECRET=<client-secret>
```

Avoid CLI transport when the G-Brain HTTP service is already running with
PGLite-backed storage. Use the HTTP transport instead.

## Failure semantics

- `/evaluate`: callers should treat network failure or 5xx as fail-closed
- `/record-execution`: best effort; tool execution should not be retried solely
  because evidence recording failed
- org mode identity mismatch: hard `403`
- missing auth: `401`

## Related documentation

- [Hermes Integration](./hermes.md)
- [G-Brain Integration](./gbrain.md)
- [MCP Server Integration](./mcp.md)
- [Five-Person Hermes + G-Brain Runbook](../runbooks/decision-core-hermes-gbrain-five-person-setup-guide-2026-05-19.md)
