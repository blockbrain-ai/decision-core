import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { isBetterSqlite3Available, loadBetterSqlite3 } from './sqlite-availability.js';
import { SqliteGraphEdgeRepository } from './sqlite-graph-edge.repository.js';
import { runMigrations } from './migrations.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyGraphEdgeCreateInput } from '../../contracts/clause.contracts.js';

const TENANT_A = 'tenant-a' as TenantId;
const TENANT_B = 'tenant-b' as TenantId;

function makeInput(overrides?: Partial<PolicyGraphEdgeCreateInput>): PolicyGraphEdgeCreateInput {
  return {
    sourceId: 'clause-1',
    targetId: 'clause-2',
    edgeType: 'depends_on',
    metadata: { reason: 'prerequisite' },
    correlationId: 'corr-1',
    ...overrides,
  };
}

describe.skipIf(!isBetterSqlite3Available())('SqliteGraphEdgeRepository', () => {
  let db: Database.Database;
  let repo: SqliteGraphEdgeRepository;

  beforeEach(() => {
    db = new (loadBetterSqlite3())(':memory:');
    runMigrations(db);
    repo = new SqliteGraphEdgeRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('CRUD', () => {
    it('creates an edge with generated fields', async () => {
      const edge = await repo.create(TENANT_A, makeInput());
      expect(edge.id).toBeDefined();
      expect(edge.tenantId).toBe(TENANT_A);
      expect(edge.auditHash).toBeDefined();
      expect(edge.createdAt).toBeDefined();
    });
  });

  describe('queries', () => {
    it('finds by source', async () => {
      await repo.create(TENANT_A, makeInput({ sourceId: 'a' }));
      await repo.create(TENANT_A, makeInput({ sourceId: 'b' }));

      const results = await repo.findBySource(TENANT_A, 'a');
      expect(results).toHaveLength(1);
      expect(results[0].sourceId).toBe('a');
    });

    it('finds by target', async () => {
      await repo.create(TENANT_A, makeInput({ targetId: 'x' }));
      await repo.create(TENANT_A, makeInput({ targetId: 'y' }));

      const results = await repo.findByTarget(TENANT_A, 'x');
      expect(results).toHaveLength(1);
      expect(results[0].targetId).toBe('x');
    });

    it('finds by edge type', async () => {
      await repo.create(TENANT_A, makeInput({ edgeType: 'depends_on' }));
      await repo.create(TENANT_A, makeInput({ edgeType: 'conflicts_with' }));
      await repo.create(TENANT_A, makeInput({ edgeType: 'depends_on' }));

      const results = await repo.findByEdgeType(TENANT_A, 'depends_on');
      expect(results).toHaveLength(2);
    });

    it('finds by tenant with filters', async () => {
      await repo.create(TENANT_A, makeInput({ edgeType: 'supersedes' }));
      await repo.create(TENANT_A, makeInput({ edgeType: 'refines' }));

      const results = await repo.findByTenant(TENANT_A, { edgeType: 'supersedes' });
      expect(results).toHaveLength(1);
    });
  });

  describe('tenant isolation (D2)', () => {
    it('does not return edges from other tenants', async () => {
      await repo.create(TENANT_A, makeInput({ sourceId: 'clause-1' }));

      const fromA = await repo.findBySource(TENANT_A, 'clause-1');
      const fromB = await repo.findBySource(TENANT_B, 'clause-1');
      expect(fromA).toHaveLength(1);
      expect(fromB).toHaveLength(0);
    });
  });
});
