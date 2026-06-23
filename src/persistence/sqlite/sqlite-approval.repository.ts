/**
 * SQLite Approval Repository
 *
 * better-sqlite3 implementation with tenant isolation (D2).
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { ApprovalRequest, ApprovalCreateInput, ApprovalFilters } from '../../contracts/approval.contracts.js';
import type { ApprovalRepository } from '../interfaces/approval.repository.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import { hashCanonicalJson } from '../../utils/audit-hash.js';

interface ApprovalRow {
  id: string;
  tenant_id: string;
  action_type: string;
  risk_class: string;
  status: string;
  priority: string;
  requested_by: string;
  requested_at: string;
  expires_at: string;
  constraint_drift: number;
  policy_rule_id: string;
  action_payload: string;
  constraint_snapshot: string;
  current_constraints: string;
  execution_status: string | null;
  executed_at: string | null;
  execution_result: string | null;
  rollback_available: number | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  correlation_id: string;
  audit_hash: string;
  created_at: string;
  updated_at: string;
}

function rowToEntity(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    actionType: row.action_type,
    riskClass: row.risk_class as ApprovalRequest['riskClass'],
    status: row.status as ApprovalRequest['status'],
    priority: row.priority as ApprovalRequest['priority'],
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    expiresAt: row.expires_at,
    constraintDrift: row.constraint_drift === 1,
    policyRuleId: row.policy_rule_id,
    actionPayload: JSON.parse(row.action_payload) as Record<string, unknown>,
    constraintSnapshot: JSON.parse(row.constraint_snapshot),
    currentConstraints: JSON.parse(row.current_constraints),
    executionStatus: row.execution_status ?? undefined,
    executedAt: row.executed_at ?? undefined,
    executionResult: row.execution_result ? JSON.parse(row.execution_result) : undefined,
    rollbackAvailable: row.rollback_available != null ? row.rollback_available === 1 : undefined,
    resolvedBy: row.resolved_by ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
    resolutionNotes: row.resolution_notes ?? undefined,
    correlationId: row.correlation_id,
    tenantId: row.tenant_id,
    auditHash: row.audit_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteApprovalRepository implements ApprovalRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  async create(tenantId: TenantId, input: ApprovalCreateInput): Promise<ApprovalRequest> {
    const now = new Date().toISOString();
    const id = generateUuidV7();
    const approval: ApprovalRequest = {
      ...input,
      id,
      tenantId,
      auditHash: hashCanonicalJson({ id, ...input, tenantId }),
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO approvals (
        id, tenant_id, action_type, risk_class, status, priority,
        requested_by, requested_at, expires_at, constraint_drift,
        policy_rule_id, action_payload, constraint_snapshot, current_constraints,
        execution_status, executed_at, execution_result, rollback_available,
        resolved_by, resolved_at, resolution_notes, correlation_id,
        audit_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, approval.actionType, approval.riskClass, approval.status,
      approval.priority, approval.requestedBy, approval.requestedAt,
      approval.expiresAt, approval.constraintDrift ? 1 : 0,
      approval.policyRuleId, JSON.stringify(approval.actionPayload),
      JSON.stringify(approval.constraintSnapshot), JSON.stringify(approval.currentConstraints),
      approval.executionStatus ?? null, approval.executedAt ?? null,
      approval.executionResult ? JSON.stringify(approval.executionResult) : null,
      approval.rollbackAvailable != null ? (approval.rollbackAvailable ? 1 : 0) : null,
      approval.resolvedBy ?? null, approval.resolvedAt ?? null,
      approval.resolutionNotes ?? null, approval.correlationId,
      approval.auditHash, now, now,
    );

    return approval;
  }

  async findById(tenantId: TenantId, id: string): Promise<ApprovalRequest | null> {
    const row = this.db.prepare(
      'SELECT * FROM approvals WHERE id = ? AND tenant_id = ?',
    ).get(id, tenantId) as ApprovalRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findAll(tenantId: TenantId, filters?: ApprovalFilters): Promise<ApprovalRequest[]> {
    let sql = 'SELECT * FROM approvals WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filters) {
      if (filters.status) {
        sql += ` AND status IN (${filters.status.map(() => '?').join(',')})`;
        params.push(...filters.status);
      }
      if (filters.priority) {
        sql += ` AND priority IN (${filters.priority.map(() => '?').join(',')})`;
        params.push(...filters.priority);
      }
      if (filters.riskClass) { sql += ' AND risk_class = ?'; params.push(filters.riskClass); }
      if (filters.from) { sql += ' AND created_at >= ?'; params.push(filters.from); }
      if (filters.to) { sql += ' AND created_at <= ?'; params.push(filters.to); }
      if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
      if (filters.offset) {
        if (!filters.limit) { sql += ' LIMIT -1'; }
        sql += ' OFFSET ?'; params.push(filters.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as ApprovalRow[];
    return rows.map(rowToEntity);
  }

  async updateStatus(
    tenantId: TenantId,
    id: string,
    status: string,
    resolution?: { resolvedBy?: string; resolvedAt?: string; resolutionNotes?: string },
  ): Promise<ApprovalRequest | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) return null;

    const updatedAt = new Date().toISOString();
    const resolvedAt = resolution?.resolvedAt ?? new Date().toISOString();

    this.db.prepare(`
      UPDATE approvals SET
        status = ?, resolved_by = ?, resolved_at = ?, resolution_notes = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(
      status, resolution?.resolvedBy ?? null, resolvedAt,
      resolution?.resolutionNotes ?? null, updatedAt,
      id, tenantId,
    );

    return {
      ...existing,
      status: status as ApprovalRequest['status'],
      resolvedBy: resolution?.resolvedBy,
      resolvedAt,
      resolutionNotes: resolution?.resolutionNotes,
      updatedAt,
    };
  }

  async count(tenantId: TenantId, filters?: ApprovalFilters): Promise<number> {
    const all = await this.findAll(tenantId, filters ? { ...filters, limit: undefined, offset: undefined } : undefined);
    return all.length;
  }
}
