# Evidence Chain Guide

Decision Core produces a tamper-evident audit trail for every decision. Evidence records are hash-linked into chains that can be verified for integrity and replayed for point-in-time analysis.

## Evidence Structure

Each evidence record contains:

```typescript
interface EvidenceRecord {
  id: string;                    // Unique record ID
  correlationId: string;         // Links all records for one decision
  timestamp: string;             // ISO 8601
  tenantId: string;              // Tenant scope (D2)
  auditHash: string;             // SHA-256 integrity hash (D3)
  operationType: string;         // What happened
  payload: Record<string, unknown>; // Operation-specific data
  sequence: number;              // Order within chain
  previousHash: string;          // Hash of prior record (chain link)
}
```

### Operation Types

Each step in the decision pipeline emits a specific operation type:

| Operation Type | When Emitted | Payload Contains |
|---------------|--------------|------------------|
| `input_received` | Request arrives | surfaceId, action, context |
| `policy_evaluation` | PDP evaluates rules | verdict, matchedPolicies, autonomyMode |
| `clause_reference` | Clause is consulted | clauseId, clauseType, controls |
| `route_decision` | Routing resolves | routeClass, confidence, skipModelCall |
| `approval_request` | Approval needed | requestId, priority, expiresAt |
| `approval_response` | Approval resolved | status (approved/rejected), resolvedBy |
| `final_verdict` | Decision complete | verdict, output, timing |

### Example Chain

A single decision evaluation produces a chain like:

```
Record 1: input_received
  sequence: 0
  previousHash: "0000...0000" (genesis)
  auditHash: "a1b2c3..."

Record 2: policy_evaluation
  sequence: 1
  previousHash: "a1b2c3..." (links to Record 1)
  auditHash: "d4e5f6..."

Record 3: route_decision
  sequence: 2
  previousHash: "d4e5f6..." (links to Record 2)
  auditHash: "g7h8i9..."

Record 4: final_verdict
  sequence: 3
  previousHash: "g7h8i9..." (links to Record 3)
  auditHash: "j0k1l2..."
```

## Hash Linking

### Audit Hash Calculation

Each record's `auditHash` is computed from:

```
auditHash = SHA-256(sequence || previousHash || payloadHash || operationType)
```

Where `payloadHash` is the SHA-256 hash of Decision Core's canonical JSON representation of the payload.

This means:
- Changing any field in the payload invalidates the record's hash
- Changing any record invalidates all subsequent records in the chain
- Inserting or removing records breaks the sequence/hash linkage

### Chain Head

The `EvidenceChain` tracks the latest hash:

```typescript
interface EvidenceChain {
  records: EvidenceRecord[];
  headHash: string;  // auditHash of the last record
}
```

The `headHash` serves as a compact integrity proof for the entire chain — if the head hash matches the expected value, every prior record is implicitly verified.

## Chain Verification

Verify chain integrity programmatically:

```typescript
interface ChainVerificationResult {
  valid: boolean;           // Overall integrity
  recordCount: number;      // Records checked
  brokenAt: number | null;  // Sequence number of first broken link
  brokenRecordId: string | null;
  expectedHash: string | null;
  actualHash: string | null;
  error: string | null;
}
```

### Verification Process

```
For each record in sequence order:
  1. Recompute auditHash from (sequence, previousHash, payloadHash, operationType)
  2. Compare computed hash to stored auditHash
  3. Verify previousHash matches prior record's auditHash
  4. If mismatch → chain is broken at this sequence number
```

### Using Verification

```typescript
import { EvidenceChainService } from '@decision-core/core';

const verification = await evidenceChainService.verify(tenantId, correlationId);

if (!verification.valid) {
  console.error(`Chain broken at record ${verification.brokenAt}`);
  console.error(`Expected: ${verification.expectedHash}`);
  console.error(`Actual: ${verification.actualHash}`);
}
```

## Replay

Historical replay reconstructs what happened at a specific point in time.

### Replay Structure

```typescript
interface HistoricalReplayResult {
  correlationId: string;
  tenantId: string;
  replayedAt: string;          // When replay was performed
  originalTimestamp: string;    // When decision originally occurred
  policySnapshot: {
    ruleSetId: string;
    version: number;
    clauseIds: string[];
    snapshotHash: string;
  };
  evidenceChain: EvidenceRecord[];
  verdict: string;
  explanation: string;
}
```

### Replay Use Cases

1. **Compliance audit:** Prove what policy was active when a decision was made.
2. **Incident investigation:** Trace why an action was allowed or blocked.
3. **Regression testing:** Verify that a policy change would not have altered past decisions.
4. **Dispute resolution:** Show the exact chain of evidence that led to a verdict.

### Performing Replay

```typescript
import { HistoricalReplayService } from '@decision-core/core';

const replay = await replayService.replay(tenantId, correlationId);

// Shows the exact policy state and evaluation that produced the original decision
console.log(replay.policySnapshot.version);
console.log(replay.evidenceChain.length, 'evidence records');
console.log(replay.verdict);
```

## Tamper Detection

Decision Core detects tampering through multiple mechanisms:

### 1. Hash Chain Integrity

Any modification to a record (content, order, insertion, deletion) breaks the hash chain:

```
Original: A → B → C → D
Tampered: A → B → C' → D  (C modified)

Verification detects:
  Record C': computed hash ≠ stored hash
  Record D: previousHash ≠ C's actual hash
```

### 2. Clause Version Chains

Policy content is independently hash-chained:

```typescript
interface ClauseVersionEntry {
  clauseId: string;
  version: number;
  text: string;
  normalizedHash: string;         // SHA-256 of normalized clause text
  previousVersionHash: string;    // Links to prior version
  chainHash: string;              // Integrity hash for version chain
}
```

This prevents retroactive policy modification — you cannot change what a clause said at decision time without breaking the version chain.

### 3. Cross-Reference Validation

Evidence records reference clause versions by hash. During replay:
- The `clause_reference` evidence record contains the `normalizedHash` of the clause text
- The clause version chain must contain an entry with that exact hash
- If the clause text has been modified since the decision, the hash will not match

## Evidence in Decision Results

Every `DecisionRunnerResult` includes an evidence summary:

```typescript
interface DecisionRunnerResult {
  // ...
  evidenceChain: {
    recordCount: number;
    headHash: string;
  };
  clauseEvidence: Array<{
    clauseId: string;
    clauseText: string;
    evidenceType: string;
    value: unknown;
    metadata: Record<string, unknown>;
  }>;
}
```

The `headHash` can be stored externally (e.g., in a separate audit system) as a compact proof that the evidence chain existed and was intact at decision time.

## Storage Considerations

Evidence records grow linearly with decisions. Storage strategies:

| Strategy | Implementation | Retention |
|----------|---------------|-----------|
| In-memory | Default | Session lifetime |
| SQLite | Persistent file | Unlimited (disk space) |
| External | Custom repository | Per compliance requirements |

For compliance-sensitive deployments, evidence should be persisted to durable storage and the `headHash` of each chain should be written to an immutable external log.

## Querying Evidence

```typescript
// Get full chain for a decision
const chain = await evidenceChainService.getChain(tenantId, correlationId);

// Get all evidence for a time range
const records = await decisionLogRepo.findAll(tenantId, {
  dateRange: { start: '2024-01-01', end: '2024-01-31' }
});

// Verify specific chain
const result = await evidenceChainService.verify(tenantId, correlationId);
```

## Best Practices

1. **Always verify before trusting:** Call `verify()` before using evidence for compliance reporting.
2. **Store headHash externally:** Write chain head hashes to a separate, immutable store for independent verification.
3. **Monitor chain breaks:** A broken chain indicates either a bug or tampering — investigate immediately.
4. **Retain evidence per policy:** Match evidence retention to your compliance framework's requirements.
5. **Use replay for audits:** Don't reconstruct decisions manually — use the replay service for authoritative reconstruction.

## Related Documentation

- [Architecture](./ARCHITECTURE.md) — Integrity layer overview
- [Security](./SECURITY.md) — Tamper detection in threat model
- [Multi-Tenancy](./MULTI-TENANCY.md) — Tenant-scoped evidence chains
- [Clause Schema Reference](./CLAUSE-SCHEMA-REFERENCE.md) — Clause version tracking
- [Trust Routing Guide](./TRUST-ROUTING-GUIDE.md) — Evidence bridge from routing
