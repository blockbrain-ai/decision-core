import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEventRepository } from './in-memory-event.repository.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { DomainEvent } from '../interfaces/event.repository.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';

const TENANT_A = 'tenant-a' as TenantId;
const TENANT_B = 'tenant-b' as TenantId;

function makeEvent(overrides?: Partial<DomainEvent>): DomainEvent {
  return {
    id: generateUuidV7(),
    type: 'decision.created',
    source: 'policy-engine',
    payload: { decision: 'allow' },
    timestamp: new Date().toISOString(),
    correlationId: generateUuidV7(),
    tenantId: TENANT_A,
    ...overrides,
  };
}

describe('InMemoryEventRepository', () => {
  let repo: InMemoryEventRepository;

  beforeEach(() => {
    repo = new InMemoryEventRepository();
  });

  describe('append and find', () => {
    it('appends and retrieves an event', async () => {
      const event = makeEvent();
      await repo.append(TENANT_A, event);

      const found = await repo.findById(TENANT_A, event.id);
      expect(found).toEqual(event);
    });

    it('finds by correlationId', async () => {
      const corrId = generateUuidV7();
      await repo.append(TENANT_A, makeEvent({ correlationId: corrId }));
      await repo.append(TENANT_A, makeEvent({ correlationId: corrId }));
      await repo.append(TENANT_A, makeEvent());

      const results = await repo.findByCorrelationId(TENANT_A, corrId);
      expect(results).toHaveLength(2);
    });
  });

  describe('filters', () => {
    it('filters by type', async () => {
      await repo.append(TENANT_A, makeEvent({ type: 'decision.created' }));
      await repo.append(TENANT_A, makeEvent({ type: 'approval.resolved' }));

      const results = await repo.findAll(TENANT_A, { type: 'decision.created' });
      expect(results).toHaveLength(1);
    });

    it('filters by source', async () => {
      await repo.append(TENANT_A, makeEvent({ source: 'policy-engine' }));
      await repo.append(TENANT_A, makeEvent({ source: 'approval-service' }));

      const results = await repo.findAll(TENANT_A, { source: 'policy-engine' });
      expect(results).toHaveLength(1);
    });
  });

  describe('tenant isolation (D2)', () => {
    it('does not return events from other tenants', async () => {
      const event = makeEvent();
      await repo.append(TENANT_A, event);

      const fromB = await repo.findById(TENANT_B, event.id);
      expect(fromB).toBeNull();
    });

    it('count is tenant-scoped', async () => {
      await repo.append(TENANT_A, makeEvent());
      await repo.append(TENANT_B, makeEvent({ tenantId: TENANT_B }));

      expect(await repo.count(TENANT_A)).toBe(1);
      expect(await repo.count(TENANT_B)).toBe(1);
    });
  });
});
