import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryApprovalRepository } from '../persistence/memory/in-memory-approval.repository.js';
import { resolveApprovalRequest } from './resolve-approval.js';
import type { TenantId } from '../contracts/common.contracts.js';
import type { ApprovalCreateInput } from '../contracts/approval.contracts.js';

const TENANT = 'tenant-sod' as TenantId;

function makeInput(overrides?: Partial<ApprovalCreateInput>): ApprovalCreateInput {
  return {
    actionType: 'file.delete',
    riskClass: 'B',
    status: 'pending',
    priority: 'medium',
    requestedBy: 'agent-proposer',
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    constraintDrift: false,
    policyRuleId: 'rule-1',
    actionPayload: {},
    constraintSnapshot: [],
    currentConstraints: [],
    correlationId: 'corr-1',
    ...overrides,
  };
}

describe('resolveApprovalRequest — separation of duties', () => {
  let repo: InMemoryApprovalRepository;
  beforeEach(() => {
    repo = new InMemoryApprovalRepository();
  });

  it('BLOCKS self-approval — the requester cannot approve their own request', async () => {
    const created = await repo.create(TENANT, makeInput({ requestedBy: 'agent-x' }));
    const result = await resolveApprovalRequest(repo, {
      tenantId: TENANT,
      approvalId: created.id,
      decision: 'approved',
      resolvedBy: 'agent-x', // same as requester
      resolverRoles: ['operator'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('separation_of_duties');
    // The request stays pending — not approved.
    expect((await repo.findById(TENANT, created.id))?.status).toBe('pending');
  });

  it('ALLOWS approval by a different identity', async () => {
    const created = await repo.create(TENANT, makeInput({ requestedBy: 'agent-x' }));
    const result = await resolveApprovalRequest(repo, {
      tenantId: TENANT,
      approvalId: created.id,
      decision: 'approved',
      resolvedBy: 'agent-y',
      resolverRoles: ['operator'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.status).toBe('approved');
      expect(result.request.resolvedBy).toBe('agent-y');
    }
  });

  it('ALLOWS a self-REJECT (you can deny your own request)', async () => {
    const created = await repo.create(TENANT, makeInput({ requestedBy: 'agent-x' }));
    const result = await resolveApprovalRequest(repo, {
      tenantId: TENANT,
      approvalId: created.id,
      decision: 'rejected',
      resolvedBy: 'agent-x',
      resolverRoles: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.status).toBe('rejected');
  });

  it('ALLOWS break-glass self-approval only with CEO role + reason + future expiry', async () => {
    const created = await repo.create(TENANT, makeInput({ requestedBy: 'ceo-1' }));
    const ok = await resolveApprovalRequest(repo, {
      tenantId: TENANT,
      approvalId: created.id,
      decision: 'approved',
      resolvedBy: 'ceo-1',
      resolverRoles: ['ceo'],
      breakGlass: { reason: 'sole on-call signer for SEV1', expiresAt: new Date(Date.now() + 3600000).toISOString() },
    });
    expect(ok.ok).toBe(true);
  });

  it('BLOCKS break-glass self-approval without CEO role', async () => {
    const created = await repo.create(TENANT, makeInput({ requestedBy: 'agent-x' }));
    const result = await resolveApprovalRequest(repo, {
      tenantId: TENANT,
      approvalId: created.id,
      decision: 'approved',
      resolvedBy: 'agent-x',
      resolverRoles: ['operator'], // not ceo
      breakGlass: { reason: 'pls', expiresAt: new Date(Date.now() + 3600000).toISOString() },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('separation_of_duties');
  });

  it('returns not_found for a missing approval and already_resolved for a non-pending one', async () => {
    const missing = await resolveApprovalRequest(repo, {
      tenantId: TENANT, approvalId: 'nope', decision: 'approved', resolvedBy: 'a', resolverRoles: [],
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('not_found');

    const created = await repo.create(TENANT, makeInput({ requestedBy: 'agent-x' }));
    await resolveApprovalRequest(repo, {
      tenantId: TENANT, approvalId: created.id, decision: 'approved', resolvedBy: 'agent-y', resolverRoles: [],
    });
    const again = await resolveApprovalRequest(repo, {
      tenantId: TENANT, approvalId: created.id, decision: 'approved', resolvedBy: 'agent-z', resolverRoles: [],
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('already_resolved');
  });
});
