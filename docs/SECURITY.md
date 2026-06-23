# Security

This document describes Decision Core's threat model, credential isolation boundaries, tenant isolation guarantees, and authentication mechanisms.

## Threat Model

### What Decision Core Protects Against

| Threat | Mitigation |
|--------|-----------|
| Unauthorized action execution | Deny-wins policy engine blocks actions that fail policy |
| Policy bypass | Fail-closed default (safe_block) when routing or policy is unavailable |
| Retroactive policy modification | Hash-linked clause version chains detect tampering |
| Evidence tampering | SHA-256 hash-linked evidence chains with verification |
| Cross-tenant data leakage | Tenant ID scoping on every repository operation |
| Credential exposure in logs | Adapter boundary prevents secret logging |
| Model unavailability exploitation | Safe-block on model failure, never silent allow |
| Privilege escalation via autonomy | Autonomy levels are enforced server-side, not client-configurable |
| Replay attacks on approvals | Approval requests include expiry, correlation, and execution tracking |

### What Decision Core Does NOT Protect Against

| Non-Goal | Rationale |
|----------|-----------|
| Network-level security (TLS, firewall) | Infrastructure responsibility |
| Operating system compromise | Out of scope — assumes trusted runtime |
| Denial of service | Rate limiting is infrastructure concern |
| Source code integrity | Covered by build pipeline and code signing |
| Model output correctness | Decision Core evaluates governance, not model quality |
| Physical security | Out of scope |

### Trust Boundaries

```
┌─────────────────────────────────────────────────────┐
│ Untrusted: External requests (HTTP, MCP, CLI input) │
├─────────────────────────────────────────────────────┤
│ Boundary: Surface layer (input validation, auth)    │
├─────────────────────────────────────────────────────┤
│ Trusted: Core engine (policy, routing, persistence) │
├─────────────────────────────────────────────────────┤
│ Boundary: Adapter layer (credential isolation)      │
├─────────────────────────────────────────────────────┤
│ External: Model providers, event services           │
└─────────────────────────────────────────────────────┘
```

## Credential Isolation

### Adapter Boundary

Credentials never cross into the core engine. The adapter layer manages secrets:

```
Core Engine                    Adapter Layer              External
┌──────────┐                  ┌──────────────┐          ┌──────────┐
│ Decision │ ─── request ───→ │ Model Gateway│ ── API ─→│ Provider │
│ Runner   │ ←── response ─── │ (owns creds) │ ←─────── │          │
└──────────┘                  └──────────────┘          └──────────┘
     │                              │
     │  Never sees API key          │  Reads from env
     │  Never logs credentials      │  Adds auth headers
```

**Guarantees:**
- Core business logic has no access to API keys or bearer tokens
- Credentials are read from environment variables at adapter initialization
- No credential is ever included in decision logs, evidence records, or event payloads
- Logger configuration strips known secret patterns from output

### Secret Audit

The `secret-audit` module scans for accidental credential exposure:

- Hardcoded API key patterns (e.g., `sk-...`, `AKIA...`)
- Bearer token literals
- Private key headers (`-----BEGIN`)
- Connection strings with embedded passwords

This runs as a quality gate — builds fail if secrets are detected in source.

### No-Secret-Logging Rule

The structured logger (Pino) is configured to:
1. Never log request/response bodies that might contain credentials
2. Redact fields matching known secret patterns
3. Never log environment variable values
4. Adapter-level logging uses safe summaries (status code, latency) not raw payloads

## Authentication

### HTTP Surface

The HTTP API supports optional authentication:

```typescript
// Bearer token auth
// Header: Authorization: Bearer <token>
```

Authentication is enforced at the HTTP surface layer before requests reach the decision engine. The core engine itself is auth-agnostic — it trusts that the surface has authenticated the caller.

### MCP Surface

The CLI MCP server runs on stdio and inherits the launching process boundary.
There is no separate token gate on `decision-core serve --mcp`. If you need
additional auth, add it in the host application or embed `createMcpServer()`
behind your own transport and access-control layer.

### SDK Surface

When embedded via SDK, authentication is the host application's responsibility. Decision Core trusts the host to provide valid tenant IDs and correlation IDs.

## Tenant Isolation

See [Multi-Tenancy](./MULTI-TENANCY.md) for full details. Security-relevant guarantees:

1. **Repository scoping:** Every query includes tenantId — no cross-tenant data access is possible through the API.
2. **Evidence isolation:** Evidence chains are per-tenant. A chain from tenant A cannot reference records from tenant B.
3. **Policy isolation:** Policy rules are scoped to tenant. Tenant A's deny rules do not affect tenant B.
4. **No tenant enumeration:** APIs do not expose tenant lists or allow querying across tenants.

## Fail-Closed Guarantees

Decision Core defaults to blocking when uncertain:

| Scenario | Behavior |
|----------|----------|
| Unknown surface (no binding) | safe_block |
| Model provider unavailable | safe_block |
| Policy gap (no matching rules) | Depends on pack; default packs include catch-all rules |
| Evidence chain verification fails | Action proceeds but chain is flagged for investigation |
| Configuration error | safe_block |
| Approval timeout | Request expires, action blocked |

The only path to `allow` is an explicit allow rule with no overriding deny rule.

## Autonomy Level Security

Autonomy levels (0-5) control enforcement strictness:

| Level | Mode | Security Posture |
|-------|------|-----------------|
| 0-1 | Strict | Maximum enforcement. Both deny and approve_required block. |
| 2-3 | Permissive | Deny blocks. Approve_required is logged but permitted. |
| 4-5 | Advisory | Everything logged but nothing blocks. |

**Security considerations:**
- Autonomy level is set at evaluation time by the calling code
- Higher autonomy levels should only be granted to trusted, well-tested agents
- Audit trail records the autonomy level used for each decision
- Changing autonomy level does not bypass deny rules at levels 0-3

## Input Validation

All external input is validated using Zod schemas (contracts):

- **Surface layer:** Validates request shape before processing
- **Policy evaluation:** Action types and surface IDs validated against known patterns
- **Evidence recording:** Payload structure validated before hash computation
- **Persistence:** Repository inputs validated before storage

Invalid input results in a 400 error (HTTP) or error response (MCP/CLI), never a policy bypass.

## Approval Security

The approval workflow includes security controls:

- **Expiry:** Approvals have a configurable TTL. Expired approvals cannot be used.
- **Correlation binding:** An approval is bound to a specific correlationId and cannot be reused for a different action.
- **Constraint drift tracking:** If conditions change between request and resolution, drift is recorded and may trigger re-evaluation.
- **Resolution attribution:** Every approval/rejection includes `resolvedBy` for accountability.
- **Execution tracking:** Whether the approved action was actually executed is recorded.
- **Rollback availability:** Whether an approved action can be reversed is tracked.

## Incident Response

When a security-relevant event occurs:

1. **Evidence chain break detected:** Investigate immediately. May indicate storage corruption or tampering.
2. **Unexpected safe_block spike:** Check provider availability and configuration.
3. **Cross-tenant access attempt:** Should be impossible via the API. If detected in logs, indicates a code defect.
4. **Credential in logs:** Rotate the credential immediately. Review logger configuration.

## Security Checklist for Integrators

- [ ] Use environment variables for all credentials, never hardcode
- [ ] Configure auth on the HTTP surface if exposed to network
- [ ] Set appropriate autonomy level (start at 0-1 for new integrations)
- [ ] Enable evidence persistence for compliance-sensitive operations
- [ ] Store evidence chain headHashes in an external immutable log
- [ ] Review policy packs before activation — understand what they allow
- [ ] Monitor for safe_block occurrences (may indicate misconfiguration)
- [ ] Verify evidence chains periodically via the verify API

## Related Documentation

- [Architecture](./ARCHITECTURE.md) — Trust boundaries in system design
- [Multi-Tenancy](./MULTI-TENANCY.md) — Tenant isolation details
- [Evidence Chain Guide](./EVIDENCE-CHAIN-GUIDE.md) — Tamper detection mechanisms
- [Providers](./PROVIDERS.md) — Credential flow per provider mode
- [FAQ](./FAQ.md) — Security-related questions
