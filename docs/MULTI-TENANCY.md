# Multi-Tenancy

Decision Core enforces tenant isolation at every layer. All data, policy, and evidence is scoped by `tenantId` (D2 standard). There is no API path to access another tenant's data.

## Tenant Scoping

### Repository Interface Pattern

Every repository method takes `tenantId` as its first parameter:

```typescript
interface PolicyRuleRepository {
  create(tenantId: TenantId, input: CreatePolicyRuleInput): Promise<PolicyRule>;
  findById(tenantId: TenantId, id: string): Promise<PolicyRule | null>;
  findAll(tenantId: TenantId, filters?: PolicyRuleFilters): Promise<PolicyRule[]>;
  findByActionType(tenantId: TenantId, actionType: string): Promise<PolicyRule[]>;
  update(tenantId: TenantId, id: string, input: UpdatePolicyRuleInput): Promise<PolicyRule | null>;
  delete(tenantId: TenantId, id: string): Promise<boolean>;
  count(tenantId: TenantId, filters?: PolicyRuleFilters): Promise<number>;
}
```

This pattern is consistent across all six repository interfaces:
- `PolicyRuleRepository`
- `DecisionLogRepository`
- `ApprovalRepository`
- `ClauseRepository`
- `GraphEdgeRepository`
- `CompiledRuleSetRepository`

### TenantId Type

`TenantId` is a branded string type that prevents accidental mixing with other string values:

```typescript
type TenantId = string & { readonly __brand: 'TenantId' };
```

This provides compile-time safety — you cannot accidentally pass a `correlationId` where a `tenantId` is expected.

## Isolation Guarantees

### 1. Data Isolation

Each tenant's data is stored separately:

- **In-memory:** Separate Map entries keyed by tenantId
- **SQLite:** All queries include `WHERE tenant_id = ?` clause

A query for tenant A's rules will never return tenant B's rules, regardless of IDs or filter parameters.

### 2. Policy Isolation

Policy rules belong to a tenant:

```typescript
// Tenant A's deny rule does NOT affect Tenant B
await policyRuleRepo.create('tenant-a' as TenantId, {
  name: 'block-deploys',
  actionType: 'deploy.*',
  verdict: 'deny',
  // ...
});

// Tenant B can still deploy
const verdict = await pdp.evaluate('tenant-b' as TenantId, {
  actionType: 'deploy.staging',
});
// verdict: allow (tenant-b has no blocking rule)
```

### 3. Evidence Isolation

Evidence chains are scoped by tenant:

```typescript
// Each evidence record includes tenantId
interface EvidenceRecord {
  tenantId: string;
  correlationId: string;
  // ...
}
```

- A chain verification for tenant A only checks tenant A's records
- Historical replay only considers tenant A's policy snapshots
- Cross-tenant evidence references are structurally impossible

### 4. Compiled Rule Set Isolation

Each tenant has its own active compiled rule set:

```typescript
// Only one active rule set per tenant
const activeRuleSet = await compiledRuleSetRepo.findActive(tenantId);
```

Activating a rule set for tenant A does not affect tenant B's active set.

### 5. Approval Isolation

Approval requests belong to tenants:

- Tenant A cannot approve or reject tenant B's requests
- Approval queries only return the calling tenant's requests
- Cross-tenant approval delegation is not supported

## Cross-Tenant Controls

### What Is Prevented

- **Cross-tenant reads:** Querying one tenant's data with another tenant's ID returns nothing
- **Cross-tenant writes:** Creating data under the wrong tenant ID is prevented by the branded type system
- **Cross-tenant policy application:** Tenant A's rules never evaluate for tenant B's actions
- **Cross-tenant evidence access:** Evidence chains cannot span tenants
- **Tenant enumeration:** No API lists all tenants or allows cross-tenant iteration

### What Is Explicitly Supported

- **Multi-tenant deployment:** A single Decision Core instance serves multiple tenants simultaneously
- **Tenant-specific configuration:** Each tenant can have different policy packs, trust bindings, and autonomy levels
- **Independent lifecycle:** Tenants can be onboarded, configured, and deprecated independently

## Default Tenant

When no tenant is specified, Decision Core uses the default tenant `_default`:

```typescript
const dc = await quickStart({
  // No tenantId specified → uses '_default'
  profile: 'personal',
});
```

For single-tenant deployments, the default tenant provides a zero-configuration experience. For multi-tenant deployments, always specify explicit tenant IDs.

## Tenant Onboarding

New tenants are onboarded through the CLI or SDK:

```bash
# CLI
decision-core onboard --tenant acme-corp --profile team
```

```typescript
// SDK
const dc = await quickStart({
  tenantId: 'acme-corp',
  profile: 'team',
  tools: ['read_*', 'write_*'],
});
```

Onboarding creates:
1. Tenant-scoped policy rules (from selected pack)
2. Tenant-scoped trust bindings
3. Initial compiled rule set (active)

## Implementation Details

### In-Memory Isolation

The in-memory repositories use composite keys:

```typescript
// Simplified: records stored with tenant prefix
private records: Map<string, PolicyRule> = new Map();

// Key format: `${tenantId}:${recordId}`
findById(tenantId: TenantId, id: string): Promise<PolicyRule | null> {
  return this.records.get(`${tenantId}:${id}`) || null;
}
```

### SQLite Isolation

SQLite tables include `tenant_id` column with indexed queries:

```sql
CREATE TABLE policy_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  -- ...
);

CREATE INDEX idx_policy_rules_tenant ON policy_rules(tenant_id);

-- All queries include tenant filter
SELECT * FROM policy_rules WHERE tenant_id = ? AND id = ?;
```

### Decision Runner Isolation

The Decision Runner passes `tenantId` through the entire pipeline:

```typescript
async execute(tenantId: TenantId, decision, context?): Promise<DecisionRunnerResult> {
  // Policy evaluation scoped to tenant
  const verdict = await this.pdp.evaluate(tenantId, ...);

  // Route resolution scoped to tenant
  const route = this.routeResolver.resolve(surfaceId, ...);

  // Evidence recorded for tenant
  recorder.append({ tenantId, ... });

  // Decision logged for tenant
  await this.decisionLog.append(tenantId, ...);
}
```

## Testing Tenant Isolation

Decision Core includes negative tests that verify isolation:

```typescript
// Create rule for tenant A
await repo.create('tenant-a' as TenantId, { name: 'rule-1', ... });

// Query from tenant B returns nothing
const results = await repo.findAll('tenant-b' as TenantId);
expect(results).toHaveLength(0);

// Cannot access tenant A's rule from tenant B
const rule = await repo.findById('tenant-b' as TenantId, ruleId);
expect(rule).toBeNull();
```

## Considerations

### Performance

- In-memory: O(n) scan within tenant's records (acceptable for typical rule counts)
- SQLite: Indexed by tenant_id for efficient queries
- No cross-tenant joins or aggregations

### Scaling

- Single-instance: Suitable for up to ~100 tenants with moderate rule counts
- For higher scale: Deploy separate instances per tenant or use external persistence with proper partitioning

### Compliance

- Tenant isolation is a hard boundary — it cannot be relaxed by configuration
- Evidence chains provide per-tenant audit trails for compliance reporting
- Tenant deletion requires explicit data purge by the deployment's persistence infrastructure

## Related Documentation

- [Architecture](./ARCHITECTURE.md) — Persistence layer design
- [Security](./SECURITY.md) — Tenant isolation in threat model
- [Evidence Chain Guide](./EVIDENCE-CHAIN-GUIDE.md) — Per-tenant evidence chains
- [Policy Authoring Guide](./POLICY-AUTHORING-GUIDE.md) — Tenant-scoped rules
- [Integration Guides](./INTEGRATION-GUIDES/) — Tenant configuration per integration
