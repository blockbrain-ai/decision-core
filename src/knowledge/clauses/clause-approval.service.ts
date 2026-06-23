/**
 * Clause Approval Service
 *
 * Manages the clause lifecycle: approve, reject, supersede.
 * Approval records carry approver identity, timestamp, and hash of the approved text.
 * Draft clauses MUST NOT be queryable through any enforcement path.
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyClause } from '../../contracts/clause.contracts.js';
import type { ClauseRepository } from '../../persistence/interfaces/clause.repository.js';
import { isValidTransition, computeClauseHash } from './clause.entity.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('clause-approval-service');

export interface ApprovalRecord {
  clauseId: string;
  tenantId: string;
  approver: string;
  action: 'approved' | 'activated' | 'rejected' | 'superseded';
  timestamp: string;
  textHash: string;
  reason?: string;
  supersededById?: string;
}

export interface ApprovedClause {
  clause: PolicyClause;
  approval: ApprovalRecord;
}

export interface RejectedClause {
  clause: PolicyClause;
  rejection: ApprovalRecord;
}

export interface SupersededClause {
  clause: PolicyClause;
  supersession: ApprovalRecord;
}

export class ClauseApprovalService {
  private approvalLog: ApprovalRecord[] = [];

  constructor(private readonly clauseRepository: ClauseRepository) {}

  async approve(
    tenantId: TenantId,
    clauseId: string,
    approver: string,
  ): Promise<ApprovedClause> {
    const clause = await this.clauseRepository.findById(tenantId, clauseId);
    if (!clause) {
      throw new Error(`Clause not found: ${clauseId}`);
    }

    if (!isValidTransition(clause.status, 'approved')) {
      throw new Error(
        `Invalid transition: cannot approve clause in status '${clause.status}'`,
      );
    }

    const now = new Date().toISOString();
    const textHash = computeClauseHash(clause.text);

    const updated = await this.clauseRepository.update(tenantId, clauseId, {
      status: 'approved',
    } as Partial<PolicyClause>);

    if (!updated) {
      throw new Error(`Failed to update clause: ${clauseId}`);
    }

    const approval: ApprovalRecord = {
      clauseId,
      tenantId,
      approver,
      action: 'approved',
      timestamp: now,
      textHash,
    };

    this.approvalLog.push(approval);
    logger.info({ tenantId, clauseId, approver }, 'Clause approved');

    return { clause: updated, approval };
  }

  async activate(
    tenantId: TenantId,
    clauseId: string,
    approver: string,
  ): Promise<ApprovedClause> {
    const clause = await this.clauseRepository.findById(tenantId, clauseId);
    if (!clause) {
      throw new Error(`Clause not found: ${clauseId}`);
    }

    if (!isValidTransition(clause.status, 'active')) {
      throw new Error(
        `Invalid transition: cannot activate clause in status '${clause.status}'`,
      );
    }

    const now = new Date().toISOString();
    const textHash = computeClauseHash(clause.text);

    const updated = await this.clauseRepository.update(tenantId, clauseId, {
      status: 'active',
    } as Partial<PolicyClause>);

    if (!updated) {
      throw new Error(`Failed to update clause: ${clauseId}`);
    }

    const approval: ApprovalRecord = {
      clauseId,
      tenantId,
      approver,
      action: 'activated',
      timestamp: now,
      textHash,
    };

    this.approvalLog.push(approval);
    logger.info({ tenantId, clauseId, approver }, 'Clause activated');

    return { clause: updated, approval };
  }

  async reject(
    tenantId: TenantId,
    clauseId: string,
    approver: string,
    reason: string,
  ): Promise<RejectedClause> {
    const clause = await this.clauseRepository.findById(tenantId, clauseId);
    if (!clause) {
      throw new Error(`Clause not found: ${clauseId}`);
    }

    if (clause.status !== 'draft') {
      throw new Error(
        `Cannot reject clause in status '${clause.status}' — only draft clauses can be rejected`,
      );
    }

    const now = new Date().toISOString();
    const textHash = computeClauseHash(clause.text);

    const rejection: ApprovalRecord = {
      clauseId,
      tenantId,
      approver,
      action: 'rejected',
      timestamp: now,
      textHash,
      reason,
    };

    this.approvalLog.push(rejection);
    logger.info({ tenantId, clauseId, approver, reason }, 'Clause rejected');

    return { clause, rejection };
  }

  async supersede(
    tenantId: TenantId,
    clauseId: string,
    newClauseId: string,
    approver: string,
  ): Promise<SupersededClause> {
    const clause = await this.clauseRepository.findById(tenantId, clauseId);
    if (!clause) {
      throw new Error(`Clause not found: ${clauseId}`);
    }

    if (!isValidTransition(clause.status, 'superseded')) {
      throw new Error(
        `Invalid transition: cannot supersede clause in status '${clause.status}'`,
      );
    }

    const newClause = await this.clauseRepository.findById(tenantId, newClauseId);
    if (!newClause) {
      throw new Error(`Replacement clause not found: ${newClauseId}`);
    }

    const now = new Date().toISOString();
    const textHash = computeClauseHash(clause.text);

    const updated = await this.clauseRepository.update(tenantId, clauseId, {
      status: 'superseded',
    } as Partial<PolicyClause>);

    if (!updated) {
      throw new Error(`Failed to update clause: ${clauseId}`);
    }

    const supersession: ApprovalRecord = {
      clauseId,
      tenantId,
      approver,
      action: 'superseded',
      timestamp: now,
      textHash,
      supersededById: newClauseId,
    };

    this.approvalLog.push(supersession);
    logger.info({ tenantId, clauseId, newClauseId, approver }, 'Clause superseded');

    return { clause: updated, supersession };
  }

  getApprovalLog(tenantId: TenantId, clauseId?: string): ApprovalRecord[] {
    return this.approvalLog.filter(
      (r) => r.tenantId === tenantId && (!clauseId || r.clauseId === clauseId),
    );
  }
}
