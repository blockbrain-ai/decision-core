/**
 * SQLite Clause Repository
 *
 * better-sqlite3 implementation with tenant isolation (D2).
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyClause, PolicyClauseCreateInput, ClauseStatus } from '../../contracts/clause.contracts.js';
import type { ClauseRepository, ClauseFilters } from '../interfaces/clause.repository.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import { hashCanonicalJson } from '../../utils/audit-hash.js';
import { computeClauseHash } from '../../knowledge/clauses/clause.entity.js';

interface ClauseRow {
  id: string;
  tenant_id: string;
  clause_key: string;
  text: string;
  normalized_hash: string;
  clause_type: string;
  section_id: string;
  source_document_id: string;
  status: string;
  effective_date: string | null;
  expiry_date: string | null;
  correlation_id: string;
  audit_hash: string;
  created_at: string;
  updated_at: string;
}

function rowToEntity(row: ClauseRow): PolicyClause {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clauseKey: row.clause_key,
    text: row.text,
    normalizedHash: row.normalized_hash,
    clauseType: row.clause_type as PolicyClause['clauseType'],
    sectionId: row.section_id,
    sourceDocumentId: row.source_document_id,
    status: row.status as PolicyClause['status'],
    effectiveDate: row.effective_date,
    expiryDate: row.expiry_date,
    correlationId: row.correlation_id,
    auditHash: row.audit_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteClauseRepository implements ClauseRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  async create(tenantId: TenantId, input: PolicyClauseCreateInput): Promise<PolicyClause> {
    const now = new Date().toISOString();
    const id = generateUuidV7();
    const normalizedHash = computeClauseHash(input.text);
    const clause: PolicyClause = {
      ...input,
      id,
      tenantId,
      normalizedHash,
      auditHash: hashCanonicalJson({ id, ...input, tenantId, normalizedHash }),
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO clauses (
        id, tenant_id, clause_key, text, normalized_hash, clause_type,
        section_id, source_document_id, status, effective_date, expiry_date,
        correlation_id, audit_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, clause.clauseKey, clause.text, clause.normalizedHash,
      clause.clauseType, clause.sectionId, clause.sourceDocumentId,
      clause.status, clause.effectiveDate, clause.expiryDate,
      clause.correlationId, clause.auditHash, now, now,
    );

    return clause;
  }

  async findById(tenantId: TenantId, id: string): Promise<PolicyClause | null> {
    const row = this.db.prepare(
      'SELECT * FROM clauses WHERE id = ? AND tenant_id = ?',
    ).get(id, tenantId) as ClauseRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findByTenant(tenantId: TenantId, filters?: ClauseFilters): Promise<PolicyClause[]> {
    let sql = 'SELECT * FROM clauses WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filters) {
      if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
      if (filters.clauseType) { sql += ' AND clause_type = ?'; params.push(filters.clauseType); }
      if (filters.sourceDocumentId) { sql += ' AND source_document_id = ?'; params.push(filters.sourceDocumentId); }
      if (filters.sectionId) { sql += ' AND section_id = ?'; params.push(filters.sectionId); }
      if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
      if (filters.offset) {
        if (!filters.limit) { sql += ' LIMIT -1'; }
        sql += ' OFFSET ?'; params.push(filters.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as ClauseRow[];
    return rows.map(rowToEntity);
  }

  async findBySourceDocument(tenantId: TenantId, sourceDocumentId: string): Promise<PolicyClause[]> {
    const rows = this.db.prepare(
      'SELECT * FROM clauses WHERE tenant_id = ? AND source_document_id = ?',
    ).all(tenantId, sourceDocumentId) as ClauseRow[];
    return rows.map(rowToEntity);
  }

  async findByStatus(tenantId: TenantId, status: ClauseStatus): Promise<PolicyClause[]> {
    const rows = this.db.prepare(
      'SELECT * FROM clauses WHERE tenant_id = ? AND status = ?',
    ).all(tenantId, status) as ClauseRow[];
    return rows.map(rowToEntity);
  }

  async update(
    tenantId: TenantId,
    id: string,
    input: Partial<PolicyClauseCreateInput>,
  ): Promise<PolicyClause | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) return null;

    const updated: PolicyClause = {
      ...existing,
      ...input,
      normalizedHash: input.text ? computeClauseHash(input.text) : existing.normalizedHash,
      updatedAt: new Date().toISOString(),
    };
    updated.auditHash = hashCanonicalJson({ ...updated });

    this.db.prepare(`
      UPDATE clauses SET
        clause_key = ?, text = ?, normalized_hash = ?, clause_type = ?,
        section_id = ?, source_document_id = ?, status = ?,
        effective_date = ?, expiry_date = ?, correlation_id = ?,
        audit_hash = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(
      updated.clauseKey, updated.text, updated.normalizedHash, updated.clauseType,
      updated.sectionId, updated.sourceDocumentId, updated.status,
      updated.effectiveDate, updated.expiryDate, updated.correlationId,
      updated.auditHash, updated.updatedAt,
      id, tenantId,
    );

    return updated;
  }
}
