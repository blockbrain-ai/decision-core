import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqlitePolicyRuleRepository } from './sqlite-policy-rule.repository.js';
import { runMigrations } from './migrations.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyRuleCreateInput } from '../../contracts/policy.contracts.js';

const TENANT_A = 'tenant-a' as TenantId;
const TENANT_B = 'tenant-b' as TenantId;

function makeInput(overrides?: Partial<PolicyRuleCreateInput>): PolicyRuleCreateInput {
  return {
    name: 'test-rule',
    description: 'A test rule',
    actionTypePattern: 'tool.*',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'safety',
    priority: 10,
    requireApproval: false,
    enabled: true,
    ...overrides,
  };
}

describe('SqlitePolicyRuleRepository', () => {
  let db: Database.Database;
  let repo: SqlitePolicyRuleRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    repo = new SqlitePolicyRuleRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('CRUD', () => {
    it('creates and retrieves a rule', async () => {
      const created = await repo.create(TENANT_A, makeInput());
      expect(created.id).toBeDefined();
      expect(created.tenantId).toBe(TENANT_A);

      const found = await repo.findById(TENANT_A, created.id);
      expect(found).toEqual(created);
    });

    it('updates a rule', async () => {
      const created = await repo.create(TENANT_A, makeInput());
      const updated = await repo.update(TENANT_A, created.id, { name: 'updated-rule' });
      expect(updated!.name).toBe('updated-rule');
      expect(updated!.id).toBe(created.id);
    });

    it('returns null when updating non-existent rule', async () => {
      const result = await repo.update(TENANT_A, 'non-existent', { name: 'x' });
      expect(result).toBeNull();
    });

    it('deletes a rule', async () => {
      const created = await repo.create(TENANT_A, makeInput());
      const deleted = await repo.delete(TENANT_A, created.id);
      expect(deleted).toBe(true);

      const found = await repo.findById(TENANT_A, created.id);
      expect(found).toBeNull();
    });

    it('returns false when deleting non-existent rule', async () => {
      const result = await repo.delete(TENANT_A, 'non-existent');
      expect(result).toBe(false);
    });
  });

  describe('findAll with filters', () => {
    it('filters by policyType', async () => {
      await repo.create(TENANT_A, makeInput({ policyType: 'safety' }));
      await repo.create(TENANT_A, makeInput({ policyType: 'compliance' }));

      const results = await repo.findAll(TENANT_A, { policyType: 'safety' });
      expect(results).toHaveLength(1);
      expect(results[0]!.policyType).toBe('safety');
    });

    it('filters by enabled', async () => {
      await repo.create(TENANT_A, makeInput({ enabled: true }));
      await repo.create(TENANT_A, makeInput({ enabled: false }));

      const results = await repo.findAll(TENANT_A, { enabled: true });
      expect(results).toHaveLength(1);
    });

    it('supports limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.create(TENANT_A, makeInput({ name: `rule-${i}` }));
      }

      const page = await repo.findAll(TENANT_A, { limit: 2, offset: 1 });
      expect(page).toHaveLength(2);
    });
  });

  describe('findByActionType', () => {
    it('matches glob patterns', async () => {
      await repo.create(TENANT_A, makeInput({ actionTypePattern: 'file.*' }));
      await repo.create(TENANT_A, makeInput({ actionTypePattern: 'db.*' }));

      const results = await repo.findByActionType(TENANT_A, 'file.write');
      expect(results).toHaveLength(1);
    });
  });

  describe('tenant isolation (D2)', () => {
    it('does not return rules from other tenants', async () => {
      const created = await repo.create(TENANT_A, makeInput());

      const fromB = await repo.findById(TENANT_B, created.id);
      expect(fromB).toBeNull();
    });

    it('returns empty list for unknown tenant', async () => {
      await repo.create(TENANT_A, makeInput());

      const results = await repo.findAll(TENANT_B);
      expect(results).toHaveLength(0);
    });

    it('counts only within tenant', async () => {
      await repo.create(TENANT_A, makeInput());
      await repo.create(TENANT_A, makeInput());
      await repo.create(TENANT_B, makeInput());

      expect(await repo.count(TENANT_A)).toBe(2);
      expect(await repo.count(TENANT_B)).toBe(1);
    });
  });
});
