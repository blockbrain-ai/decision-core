import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteCompiledRuleSetRepository } from './sqlite-compiled-rule-set.repository.js';
import { runMigrations } from './migrations.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { CompiledRuleSetCreateInput } from '../../contracts/clause.contracts.js';

const TENANT_A = 'tenant-a' as TenantId;
const TENANT_B = 'tenant-b' as TenantId;

function makeInput(overrides?: Partial<CompiledRuleSetCreateInput>): CompiledRuleSetCreateInput {
  return {
    name: 'AML Rules v1',
    version: 1,
    status: 'active',
    clauseIds: ['clause-1', 'clause-2'],
    compiledAt: '2026-01-01T00:00:00.000Z',
    activatedAt: '2026-01-01T00:00:00.000Z',
    correlationId: 'corr-1',
    ...overrides,
  };
}

describe('SqliteCompiledRuleSetRepository', () => {
  let db: Database.Database;
  let repo: SqliteCompiledRuleSetRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    repo = new SqliteCompiledRuleSetRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('CRUD', () => {
    it('creates and retrieves a rule set', async () => {
      const created = await repo.create(TENANT_A, makeInput());
      expect(created.id).toBeDefined();
      expect(created.tenantId).toBe(TENANT_A);
      expect(created.auditHash).toBeDefined();

      const found = await repo.findById(TENANT_A, created.id);
      expect(found).toEqual(created);
    });

    it('returns null for missing id', async () => {
      const found = await repo.findById(TENANT_A, 'nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('queries', () => {
    it('finds active rule set', async () => {
      await repo.create(TENANT_A, makeInput({ status: 'inactive', name: 'old' }));
      await repo.create(TENANT_A, makeInput({ status: 'active', name: 'current' }));

      const active = await repo.findActive(TENANT_A);
      expect(active).not.toBeNull();
      expect(active!.name).toBe('current');
    });

    it('returns null when no active set', async () => {
      await repo.create(TENANT_A, makeInput({ status: 'inactive' }));
      const active = await repo.findActive(TENANT_A);
      expect(active).toBeNull();
    });

    it('finds all by tenant', async () => {
      await repo.create(TENANT_A, makeInput());
      await repo.create(TENANT_A, makeInput({ version: 2 }));

      const all = await repo.findByTenant(TENANT_A);
      expect(all).toHaveLength(2);
    });
  });

  describe('tenant isolation (D2)', () => {
    it('does not return records from other tenants via findById', async () => {
      const created = await repo.create(TENANT_A, makeInput());
      const fromB = await repo.findById(TENANT_B, created.id);
      expect(fromB).toBeNull();
    });

    it('does not return records from other tenants via findActive', async () => {
      await repo.create(TENANT_A, makeInput({ status: 'active' }));
      const fromB = await repo.findActive(TENANT_B);
      expect(fromB).toBeNull();
    });

    it('does not return records from other tenants via findByTenant', async () => {
      await repo.create(TENANT_A, makeInput());
      const fromB = await repo.findByTenant(TENANT_B);
      expect(fromB).toHaveLength(0);
    });
  });
});
