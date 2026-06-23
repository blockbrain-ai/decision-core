import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { isBetterSqlite3Available, loadBetterSqlite3 } from './sqlite-availability.js';
import { SqliteApprovalRepository } from './sqlite-approval.repository.js';
import { runMigrations } from './migrations.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { ApprovalCreateInput } from '../../contracts/approval.contracts.js';

const TENANT_A = 'tenant-a' as TenantId;
const TENANT_B = 'tenant-b' as TenantId;

function makeInput(overrides?: Partial<ApprovalCreateInput>): ApprovalCreateInput {
  return {
    actionType: 'file.delete',
    riskClass: 'B',
    status: 'pending',
    priority: 'medium',
    requestedBy: 'agent-1',
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    constraintDrift: false,
    policyRuleId: 'rule-1',
    actionPayload: { path: '/tmp/file.txt' },
    constraintSnapshot: [],
    currentConstraints: [],
    correlationId: 'corr-1',
    ...overrides,
  };
}

describe.skipIf(!isBetterSqlite3Available())('SqliteApprovalRepository', () => {
  let db: Database.Database;
  let repo: SqliteApprovalRepository;

  beforeEach(() => {
    db = new (loadBetterSqlite3())(':memory:');
    runMigrations(db);
    repo = new SqliteApprovalRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('CRUD', () => {
    it('creates and retrieves an approval', async () => {
      const created = await repo.create(TENANT_A, makeInput());
      expect(created.id).toBeDefined();
      expect(created.tenantId).toBe(TENANT_A);
      expect(created.auditHash).toBeDefined();

      const found = await repo.findById(TENANT_A, created.id);
      expect(found).toEqual(created);
    });

    it('updates status with resolution', async () => {
      const created = await repo.create(TENANT_A, makeInput());
      const resolved = await repo.updateStatus(TENANT_A, created.id, 'approved', {
        resolvedBy: 'human-1',
        resolutionNotes: 'Looks good',
      });

      expect(resolved!.status).toBe('approved');
      expect(resolved!.resolvedBy).toBe('human-1');
      expect(resolved!.resolutionNotes).toBe('Looks good');
    });

    it('returns null when updating non-existent approval', async () => {
      const result = await repo.updateStatus(TENANT_A, 'non-existent', 'approved');
      expect(result).toBeNull();
    });
  });

  describe('filters', () => {
    it('filters by status', async () => {
      await repo.create(TENANT_A, makeInput({ status: 'pending' }));
      await repo.create(TENANT_A, makeInput({ status: 'approved' }));

      const results = await repo.findAll(TENANT_A, { status: ['pending'] });
      expect(results).toHaveLength(1);
    });

    it('filters by priority', async () => {
      await repo.create(TENANT_A, makeInput({ priority: 'high' }));
      await repo.create(TENANT_A, makeInput({ priority: 'low' }));

      const results = await repo.findAll(TENANT_A, { priority: ['high'] });
      expect(results).toHaveLength(1);
    });
  });

  describe('tenant isolation (D2)', () => {
    it('does not return approvals from other tenants', async () => {
      const created = await repo.create(TENANT_A, makeInput());

      const fromB = await repo.findById(TENANT_B, created.id);
      expect(fromB).toBeNull();
    });

    it('count is tenant-scoped', async () => {
      await repo.create(TENANT_A, makeInput());
      await repo.create(TENANT_B, makeInput());

      expect(await repo.count(TENANT_A)).toBe(1);
      expect(await repo.count(TENANT_B)).toBe(1);
    });
  });
});
