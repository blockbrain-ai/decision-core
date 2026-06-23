/**
 * Tests for Enforcement Guard
 *
 * Critical negative control tests proving that non-active clauses
 * cannot leak into enforcement queries.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyClauseCreateInput } from '../../contracts/clause.contracts.js';
import { InMemoryClauseRepository } from '../../persistence/memory/in-memory-clause.repository.js';
import { ClauseApprovalService } from './clause-approval.service.js';
import { filterEnforceable, getEnforceableClauses } from './enforcement-guard.js';

const TENANT = 'test-tenant' as TenantId;

function makeClauseInput(overrides?: Partial<PolicyClauseCreateInput>): PolicyClauseCreateInput {
  return {
    clauseKey: 'policy/section/clause-1',
    text: 'All transactions over $10,000 must be reviewed.',
    clauseType: 'obligation',
    sectionId: 'sec-1',
    sourceDocumentId: 'doc-1',
    status: 'draft',
    effectiveDate: null,
    expiryDate: null,
    correlationId: 'corr-1',
    ...overrides,
  };
}

describe('Enforcement Guard', () => {
  let repo: InMemoryClauseRepository;
  let approvalService: ClauseApprovalService;

  beforeEach(() => {
    repo = new InMemoryClauseRepository();
    approvalService = new ClauseApprovalService(repo);
  });

  describe('NEGATIVE CONTROL: draft clauses blocked from enforcement', () => {
    it('draft clause is never returned by getEnforceableClauses', async () => {
      await repo.create(TENANT, makeClauseInput({ status: 'draft' } as PolicyClauseCreateInput));

      const enforceable = await getEnforceableClauses(repo, TENANT);

      expect(enforceable).toHaveLength(0);
    });

    it('draft clause is excluded by filterEnforceable', async () => {
      const clause = await repo.create(TENANT, makeClauseInput({ status: 'draft' } as PolicyClauseCreateInput));

      const result = filterEnforceable([clause]);

      expect(result).toHaveLength(0);
    });
  });

  describe('NEGATIVE CONTROL: superseded clauses blocked from enforcement', () => {
    it('superseded clause is never returned by getEnforceableClauses', async () => {
      const oldClause = await repo.create(TENANT, makeClauseInput({ status: 'active' } as PolicyClauseCreateInput));
      const newClause = await repo.create(
        TENANT,
        makeClauseInput({ clauseKey: 'policy/section/clause-2', text: 'New clause.' }),
      );

      await approvalService.supersede(TENANT, oldClause.id, newClause.id, 'admin@corp.com');

      const enforceable = await getEnforceableClauses(repo, TENANT);

      expect(enforceable).toHaveLength(0);
      expect(enforceable.find((c) => c.id === oldClause.id)).toBeUndefined();
    });

    it('superseded clause is excluded by filterEnforceable', async () => {
      const clause = await repo.create(TENANT, makeClauseInput({ status: 'superseded' } as PolicyClauseCreateInput));

      const result = filterEnforceable([clause]);

      expect(result).toHaveLength(0);
    });
  });

  describe('NEGATIVE CONTROL: future-dated clause not active yet', () => {
    it('clause with future effectiveDate is excluded from enforcement', async () => {
      const futureDate = '2099-01-01T00:00:00.000Z';
      const clause = await repo.create(
        TENANT,
        makeClauseInput({
          status: 'active',
          effectiveDate: futureDate,
        } as PolicyClauseCreateInput),
      );

      const enforceable = await getEnforceableClauses(repo, TENANT);

      expect(enforceable).toHaveLength(0);
      expect(enforceable.find((c) => c.id === clause.id)).toBeUndefined();
    });

    it('clause with past effectiveDate IS included in enforcement', async () => {
      const pastDate = '2020-01-01T00:00:00.000Z';
      await repo.create(
        TENANT,
        makeClauseInput({
          status: 'active',
          effectiveDate: pastDate,
        } as PolicyClauseCreateInput),
      );

      const enforceable = await getEnforceableClauses(repo, TENANT);

      expect(enforceable).toHaveLength(1);
    });
  });

  describe('NEGATIVE CONTROL: approved-but-not-active clause blocked', () => {
    it('approved clause is not returned by getEnforceableClauses', async () => {
      const clause = await repo.create(TENANT, makeClauseInput());
      await approvalService.approve(TENANT, clause.id, 'admin@corp.com');

      const enforceable = await getEnforceableClauses(repo, TENANT);

      expect(enforceable).toHaveLength(0);
    });
  });

  describe('active clause passes enforcement guard', () => {
    it('active clause with no date constraints is enforceable', async () => {
      await repo.create(
        TENANT,
        makeClauseInput({ status: 'active' } as PolicyClauseCreateInput),
      );

      const enforceable = await getEnforceableClauses(repo, TENANT);

      expect(enforceable).toHaveLength(1);
    });

    it('active clause within date range is enforceable', async () => {
      await repo.create(
        TENANT,
        makeClauseInput({
          status: 'active',
          effectiveDate: '2020-01-01T00:00:00.000Z',
          expiryDate: '2099-12-31T23:59:59.999Z',
        } as PolicyClauseCreateInput),
      );

      const enforceable = await getEnforceableClauses(repo, TENANT);

      expect(enforceable).toHaveLength(1);
    });

    it('expired clause is excluded', async () => {
      await repo.create(
        TENANT,
        makeClauseInput({
          status: 'active',
          effectiveDate: '2020-01-01T00:00:00.000Z',
          expiryDate: '2020-06-01T00:00:00.000Z',
        } as PolicyClauseCreateInput),
      );

      const enforceable = await getEnforceableClauses(repo, TENANT);

      expect(enforceable).toHaveLength(0);
    });
  });

  describe('full lifecycle integration', () => {
    it('clause goes through draft → approved → active → enforceable', async () => {
      const clause = await repo.create(TENANT, makeClauseInput());

      // Draft: not enforceable
      let enforceable = await getEnforceableClauses(repo, TENANT);
      expect(enforceable).toHaveLength(0);

      // Approve: still not enforceable
      await approvalService.approve(TENANT, clause.id, 'admin@corp.com');
      enforceable = await getEnforceableClauses(repo, TENANT);
      expect(enforceable).toHaveLength(0);

      // Activate: now enforceable
      await approvalService.activate(TENANT, clause.id, 'admin@corp.com');
      enforceable = await getEnforceableClauses(repo, TENANT);
      expect(enforceable).toHaveLength(1);
      expect(enforceable[0].id).toBe(clause.id);
    });

    it('clause goes active → superseded → not enforceable', async () => {
      const clause = await repo.create(TENANT, makeClauseInput({ status: 'active' } as PolicyClauseCreateInput));
      const replacement = await repo.create(
        TENANT,
        makeClauseInput({ clauseKey: 'policy/section/clause-2' }),
      );

      let enforceable = await getEnforceableClauses(repo, TENANT);
      expect(enforceable).toHaveLength(1);

      await approvalService.supersede(TENANT, clause.id, replacement.id, 'admin@corp.com');

      enforceable = await getEnforceableClauses(repo, TENANT);
      expect(enforceable).toHaveLength(0);
    });
  });
});
