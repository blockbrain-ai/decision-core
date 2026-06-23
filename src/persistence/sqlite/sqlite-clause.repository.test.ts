import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { isBetterSqlite3Available, loadBetterSqlite3 } from './sqlite-availability.js';
import { SqliteClauseRepository } from './sqlite-clause.repository.js';
import { runMigrations } from './migrations.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyClauseCreateInput } from '../../contracts/clause.contracts.js';
import { computeClauseHash } from '../../knowledge/clauses/clause.entity.js';

const TENANT_A = 'tenant-a' as TenantId;
const TENANT_B = 'tenant-b' as TenantId;

function makeInput(overrides?: Partial<PolicyClauseCreateInput>): PolicyClauseCreateInput {
  return {
    clauseKey: 'AML-001',
    text: 'All transactions above $10,000 require dual authorization.',
    clauseType: 'threshold',
    sectionId: 'sec-1',
    sourceDocumentId: 'doc-1',
    status: 'draft',
    effectiveDate: null,
    expiryDate: null,
    correlationId: 'corr-1',
    ...overrides,
  };
}

describe.skipIf(!isBetterSqlite3Available())('SqliteClauseRepository', () => {
  let db: Database.Database;
  let repo: SqliteClauseRepository;

  beforeEach(() => {
    db = new (loadBetterSqlite3())(':memory:');
    runMigrations(db);
    repo = new SqliteClauseRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('CRUD', () => {
    it('creates and retrieves a clause', async () => {
      const created = await repo.create(TENANT_A, makeInput());
      expect(created.id).toBeDefined();
      expect(created.tenantId).toBe(TENANT_A);
      expect(created.auditHash).toBeDefined();
      expect(created.normalizedHash).toBeDefined();
      expect(created.createdAt).toBeDefined();

      const found = await repo.findById(TENANT_A, created.id);
      expect(found).toEqual(created);
    });

    it('returns null for missing id', async () => {
      const found = await repo.findById(TENANT_A, 'nonexistent');
      expect(found).toBeNull();
    });

    it('updates a clause', async () => {
      const created = await repo.create(TENANT_A, makeInput());
      await new Promise((r) => setTimeout(r, 2));
      const updated = await repo.update(TENANT_A, created.id, { status: 'approved' });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('approved');
      expect(updated!.updatedAt >= created.updatedAt).toBe(true);
    });

    it('returns null when updating nonexistent', async () => {
      const result = await repo.update(TENANT_A, 'nope', { status: 'approved' });
      expect(result).toBeNull();
    });

    it('recomputes hash when text changes', async () => {
      const created = await repo.create(TENANT_A, makeInput());
      const updated = await repo.update(TENANT_A, created.id, { text: 'New text' });
      expect(updated!.normalizedHash).not.toBe(created.normalizedHash);
      expect(updated!.normalizedHash).toBe(computeClauseHash('New text'));
    });
  });

  describe('queries', () => {
    it('finds by source document', async () => {
      await repo.create(TENANT_A, makeInput({ sourceDocumentId: 'doc-1' }));
      await repo.create(TENANT_A, makeInput({ sourceDocumentId: 'doc-2' }));

      const results = await repo.findBySourceDocument(TENANT_A, 'doc-1');
      expect(results).toHaveLength(1);
      expect(results[0].sourceDocumentId).toBe('doc-1');
    });

    it('finds by status', async () => {
      await repo.create(TENANT_A, makeInput({ status: 'draft' }));
      await repo.create(TENANT_A, makeInput({ status: 'active' }));

      const drafts = await repo.findByStatus(TENANT_A, 'draft');
      expect(drafts).toHaveLength(1);
      expect(drafts[0].status).toBe('draft');
    });

    it('finds by tenant with filters', async () => {
      await repo.create(TENANT_A, makeInput({ clauseType: 'obligation' }));
      await repo.create(TENANT_A, makeInput({ clauseType: 'prohibition' }));
      await repo.create(TENANT_A, makeInput({ clauseType: 'obligation' }));

      const results = await repo.findByTenant(TENANT_A, { clauseType: 'obligation' });
      expect(results).toHaveLength(2);
    });

    it('supports pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.create(TENANT_A, makeInput({ clauseKey: `K-${i}` }));
      }
      const page = await repo.findByTenant(TENANT_A, { limit: 2, offset: 1 });
      expect(page).toHaveLength(2);
    });
  });

  describe('tenant isolation (D2)', () => {
    it('does not return records from other tenants via findById', async () => {
      const created = await repo.create(TENANT_A, makeInput());
      const fromB = await repo.findById(TENANT_B, created.id);
      expect(fromB).toBeNull();
    });

    it('does not return records from other tenants via findByTenant', async () => {
      await repo.create(TENANT_A, makeInput());
      const fromB = await repo.findByTenant(TENANT_B);
      expect(fromB).toHaveLength(0);
    });

    it('does not allow cross-tenant updates', async () => {
      const created = await repo.create(TENANT_A, makeInput());
      const result = await repo.update(TENANT_B, created.id, { status: 'approved' });
      expect(result).toBeNull();
    });
  });

  describe('hash determinism', () => {
    it('produces same hash for identical text', async () => {
      const text = 'Identical clause text for hash testing.';
      const c1 = await repo.create(TENANT_A, makeInput({ text }));
      const c2 = await repo.create(TENANT_A, makeInput({ text }));
      expect(c1.normalizedHash).toBe(c2.normalizedHash);
    });

    it('produces different hash for different text', async () => {
      const c1 = await repo.create(TENANT_A, makeInput({ text: 'Text A' }));
      const c2 = await repo.create(TENANT_A, makeInput({ text: 'Text B' }));
      expect(c1.normalizedHash).not.toBe(c2.normalizedHash);
    });
  });
});
