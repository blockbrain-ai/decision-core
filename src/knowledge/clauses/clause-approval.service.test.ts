/**
 * Tests for ClauseApprovalService
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyClauseCreateInput } from '../../contracts/clause.contracts.js';
import { InMemoryClauseRepository } from '../../persistence/memory/in-memory-clause.repository.js';
import { ClauseApprovalService } from './clause-approval.service.js';

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

describe('ClauseApprovalService', () => {
  let repo: InMemoryClauseRepository;
  let service: ClauseApprovalService;

  beforeEach(() => {
    repo = new InMemoryClauseRepository();
    service = new ClauseApprovalService(repo);
  });

  describe('approve', () => {
    it('transitions a draft clause to approved', async () => {
      const clause = await repo.create(TENANT, makeClauseInput());

      const result = await service.approve(TENANT, clause.id, 'admin@corp.com');

      expect(result.clause.status).toBe('approved');
      expect(result.approval.approver).toBe('admin@corp.com');
      expect(result.approval.textHash).toBeTruthy();
      expect(result.approval.timestamp).toBeTruthy();
    });

    it('rejects approval of non-draft clause', async () => {
      const clause = await repo.create(TENANT, makeClauseInput({ status: 'active' } as PolicyClauseCreateInput));

      await expect(
        service.approve(TENANT, clause.id, 'admin@corp.com'),
      ).rejects.toThrow(/Invalid transition/);
    });

    it('rejects approval of non-existent clause', async () => {
      await expect(
        service.approve(TENANT, 'non-existent', 'admin@corp.com'),
      ).rejects.toThrow(/not found/);
    });
  });

  describe('activate', () => {
    it('transitions an approved clause to active', async () => {
      const clause = await repo.create(TENANT, makeClauseInput());
      await service.approve(TENANT, clause.id, 'admin@corp.com');

      const result = await service.activate(TENANT, clause.id, 'admin@corp.com');

      expect(result.clause.status).toBe('active');
    });

    it('rejects activation of draft clause', async () => {
      const clause = await repo.create(TENANT, makeClauseInput());

      await expect(
        service.activate(TENANT, clause.id, 'admin@corp.com'),
      ).rejects.toThrow(/Invalid transition/);
    });
  });

  describe('reject', () => {
    it('rejects a draft clause with a reason', async () => {
      const clause = await repo.create(TENANT, makeClauseInput());

      const result = await service.reject(TENANT, clause.id, 'reviewer@corp.com', 'Unclear language');

      expect(result.rejection.action).toBe('rejected');
      expect(result.rejection.reason).toBe('Unclear language');
      expect(result.rejection.approver).toBe('reviewer@corp.com');
      expect(result.clause.status).toBe('draft');
    });

    it('cannot reject an active clause', async () => {
      const clause = await repo.create(TENANT, makeClauseInput({ status: 'active' } as PolicyClauseCreateInput));

      await expect(
        service.reject(TENANT, clause.id, 'reviewer@corp.com', 'Too late'),
      ).rejects.toThrow(/only draft/);
    });
  });

  describe('supersede', () => {
    it('supersedes an active clause with a new clause', async () => {
      const oldClause = await repo.create(TENANT, makeClauseInput({ status: 'active' } as PolicyClauseCreateInput));
      const newClause = await repo.create(
        TENANT,
        makeClauseInput({
          clauseKey: 'policy/section/clause-2',
          text: 'Updated policy text.',
        }),
      );

      const result = await service.supersede(TENANT, oldClause.id, newClause.id, 'admin@corp.com');

      expect(result.clause.status).toBe('superseded');
      expect(result.supersession.supersededById).toBe(newClause.id);
    });

    it('can supersede a draft clause (fast-track replacement)', async () => {
      const oldClause = await repo.create(TENANT, makeClauseInput());
      const newClause = await repo.create(
        TENANT,
        makeClauseInput({ clauseKey: 'policy/section/clause-2' }),
      );

      const result = await service.supersede(TENANT, oldClause.id, newClause.id, 'admin@corp.com');

      expect(result.clause.status).toBe('superseded');
    });

    it('cannot supersede an already superseded clause', async () => {
      const clause = await repo.create(TENANT, makeClauseInput({ status: 'superseded' } as PolicyClauseCreateInput));
      const newClause = await repo.create(TENANT, makeClauseInput({ clauseKey: 'key-2' }));

      await expect(
        service.supersede(TENANT, clause.id, newClause.id, 'admin@corp.com'),
      ).rejects.toThrow(/Invalid transition/);
    });
  });

  describe('getApprovalLog', () => {
    it('returns approval records for a clause', async () => {
      const clause = await repo.create(TENANT, makeClauseInput());
      await service.approve(TENANT, clause.id, 'admin@corp.com');

      const log = service.getApprovalLog(TENANT, clause.id);

      expect(log).toHaveLength(1);
      expect(log[0].action).toBe('approved');
      expect(log[0].approver).toBe('admin@corp.com');
    });
  });
});
