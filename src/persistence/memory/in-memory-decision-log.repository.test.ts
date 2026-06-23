import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDecisionLogRepository } from './in-memory-decision-log.repository.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { DecisionRecord } from '../../contracts/decision.contracts.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';

const TENANT_A = 'tenant-a' as TenantId;
const TENANT_B = 'tenant-b' as TenantId;

function makeRecord(overrides?: Partial<DecisionRecord>): DecisionRecord {
  const now = new Date().toISOString();
  return {
    id: generateUuidV7(),
    surface: 'sdk',
    toolName: 'test-tool',
    status: 'generated',
    confidence: 0.95,
    latency: 42,
    input: { key: 'value' },
    output: { result: 'ok' },
    correlationId: generateUuidV7(),
    tenantId: TENANT_A,
    auditHash: 'abc123',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('InMemoryDecisionLogRepository', () => {
  let repo: InMemoryDecisionLogRepository;

  beforeEach(() => {
    repo = new InMemoryDecisionLogRepository();
  });

  describe('append and find', () => {
    it('appends and retrieves a record', async () => {
      const record = makeRecord();
      await repo.append(TENANT_A, record);

      const found = await repo.findById(TENANT_A, record.id);
      expect(found).toEqual(record);
    });

    it('finds by correlationId', async () => {
      const corrId = generateUuidV7();
      await repo.append(TENANT_A, makeRecord({ correlationId: corrId }));
      await repo.append(TENANT_A, makeRecord({ correlationId: corrId }));
      await repo.append(TENANT_A, makeRecord());

      const results = await repo.findByCorrelationId(TENANT_A, corrId);
      expect(results).toHaveLength(2);
    });
  });

  describe('filters', () => {
    it('filters by surface', async () => {
      await repo.append(TENANT_A, makeRecord({ surface: 'sdk' }));
      await repo.append(TENANT_A, makeRecord({ surface: 'mcp' }));

      const results = await repo.findAll(TENANT_A, { surface: 'sdk' });
      expect(results).toHaveLength(1);
    });

    it('filters by status', async () => {
      await repo.append(TENANT_A, makeRecord({ status: 'generated' }));
      await repo.append(TENANT_A, makeRecord({ status: 'blocked' }));

      const results = await repo.findAll(TENANT_A, { status: ['blocked'] });
      expect(results).toHaveLength(1);
    });
  });

  describe('tenant isolation (D2)', () => {
    it('does not return records from other tenants', async () => {
      const record = makeRecord();
      await repo.append(TENANT_A, record);

      const fromB = await repo.findById(TENANT_B, record.id);
      expect(fromB).toBeNull();
    });

    it('count is tenant-scoped', async () => {
      await repo.append(TENANT_A, makeRecord());
      await repo.append(TENANT_A, makeRecord());
      await repo.append(TENANT_B, makeRecord({ tenantId: TENANT_B }));

      expect(await repo.count(TENANT_A)).toBe(2);
      expect(await repo.count(TENANT_B)).toBe(1);
    });
  });
});
