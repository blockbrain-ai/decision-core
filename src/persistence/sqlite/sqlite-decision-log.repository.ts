/**
 * SQLite Decision Log Repository
 *
 * Append-only better-sqlite3 implementation with tenant isolation (D2).
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { DecisionRecord, DecisionFilters } from '../../contracts/decision.contracts.js';
import type { DecisionLogRepository } from '../interfaces/decision-log.repository.js';

interface DecisionLogRow {
  id: string;
  tenant_id: string;
  surface: string;
  tool_name: string;
  status: string;
  confidence: number;
  model: string | null;
  latency: number;
  input: string;
  output: string;
  quality_gate: string | null;
  correlation_id: string;
  audit_hash: string;
  created_at: string;
  updated_at: string;
}

function rowToEntity(row: DecisionLogRow): DecisionRecord {
  return {
    id: row.id,
    surface: row.surface,
    toolName: row.tool_name,
    status: row.status as DecisionRecord['status'],
    confidence: row.confidence,
    model: row.model ?? undefined,
    latency: row.latency,
    input: JSON.parse(row.input) as Record<string, unknown>,
    output: JSON.parse(row.output) as Record<string, unknown>,
    qualityGate: row.quality_gate ? JSON.parse(row.quality_gate) : undefined,
    correlationId: row.correlation_id,
    tenantId: row.tenant_id,
    auditHash: row.audit_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteDecisionLogRepository implements DecisionLogRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  async append(tenantId: TenantId, record: DecisionRecord): Promise<DecisionRecord> {
    this.db.prepare(`
      INSERT INTO decision_logs (
        id, tenant_id, surface, tool_name, status, confidence, model,
        latency, input, output, quality_gate, correlation_id, audit_hash,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, tenantId, record.surface, record.toolName, record.status,
      record.confidence, record.model ?? null, record.latency,
      JSON.stringify(record.input), JSON.stringify(record.output),
      record.qualityGate ? JSON.stringify(record.qualityGate) : null,
      record.correlationId, record.auditHash, record.createdAt, record.updatedAt,
    );
    return record;
  }

  async findById(tenantId: TenantId, id: string): Promise<DecisionRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM decision_logs WHERE id = ? AND tenant_id = ?',
    ).get(id, tenantId) as DecisionLogRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findAll(tenantId: TenantId, filters?: DecisionFilters): Promise<DecisionRecord[]> {
    let sql = 'SELECT * FROM decision_logs WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filters) {
      if (filters.surface) { sql += ' AND surface = ?'; params.push(filters.surface); }
      if (filters.toolName) { sql += ' AND tool_name = ?'; params.push(filters.toolName); }
      if (filters.status) {
        sql += ` AND status IN (${filters.status.map(() => '?').join(',')})`;
        params.push(...filters.status);
      }
      if (filters.minConfidence !== undefined) { sql += ' AND confidence >= ?'; params.push(filters.minConfidence); }
      if (filters.from) { sql += ' AND created_at >= ?'; params.push(filters.from); }
      if (filters.to) { sql += ' AND created_at <= ?'; params.push(filters.to); }
      if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
      if (filters.offset) {
        if (!filters.limit) { sql += ' LIMIT -1'; }
        sql += ' OFFSET ?'; params.push(filters.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as DecisionLogRow[];
    return rows.map(rowToEntity);
  }

  async findByCorrelationId(tenantId: TenantId, correlationId: string): Promise<DecisionRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM decision_logs WHERE tenant_id = ? AND correlation_id = ?',
    ).all(tenantId, correlationId) as DecisionLogRow[];
    return rows.map(rowToEntity);
  }

  async count(tenantId: TenantId, filters?: DecisionFilters): Promise<number> {
    const all = await this.findAll(tenantId, filters ? { ...filters, limit: undefined, offset: undefined } : undefined);
    return all.length;
  }
}
