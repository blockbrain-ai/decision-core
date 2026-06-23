/**
 * SQLite Graph Edge Repository
 *
 * better-sqlite3 implementation with tenant isolation (D2).
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyGraphEdge, PolicyGraphEdgeCreateInput, GraphEdgeType } from '../../contracts/clause.contracts.js';
import type { GraphEdgeRepository, GraphEdgeFilters } from '../interfaces/graph-edge.repository.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import { hashCanonicalJson } from '../../utils/audit-hash.js';

interface GraphEdgeRow {
  id: string;
  tenant_id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  metadata: string;
  correlation_id: string;
  audit_hash: string;
  created_at: string;
}

function rowToEntity(row: GraphEdgeRow): PolicyGraphEdge {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sourceId: row.source_id,
    targetId: row.target_id,
    edgeType: row.edge_type as PolicyGraphEdge['edgeType'],
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    correlationId: row.correlation_id,
    auditHash: row.audit_hash,
    createdAt: row.created_at,
  };
}

export class SqliteGraphEdgeRepository implements GraphEdgeRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  async create(tenantId: TenantId, input: PolicyGraphEdgeCreateInput): Promise<PolicyGraphEdge> {
    const id = generateUuidV7();
    const edge: PolicyGraphEdge = {
      ...input,
      id,
      tenantId,
      auditHash: hashCanonicalJson({ id, ...input, tenantId }),
      createdAt: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO graph_edges (
        id, tenant_id, source_id, target_id, edge_type,
        metadata, correlation_id, audit_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, edge.sourceId, edge.targetId, edge.edgeType,
      JSON.stringify(edge.metadata), edge.correlationId,
      edge.auditHash, edge.createdAt,
    );

    return edge;
  }

  async delete(tenantId: TenantId, edgeId: string): Promise<boolean> {
    const result = this.db.prepare(
      'DELETE FROM graph_edges WHERE id = ? AND tenant_id = ?',
    ).run(edgeId, tenantId);
    return result.changes > 0;
  }

  async findBySource(tenantId: TenantId, sourceId: string): Promise<PolicyGraphEdge[]> {
    const rows = this.db.prepare(
      'SELECT * FROM graph_edges WHERE tenant_id = ? AND source_id = ?',
    ).all(tenantId, sourceId) as GraphEdgeRow[];
    return rows.map(rowToEntity);
  }

  async findByTarget(tenantId: TenantId, targetId: string): Promise<PolicyGraphEdge[]> {
    const rows = this.db.prepare(
      'SELECT * FROM graph_edges WHERE tenant_id = ? AND target_id = ?',
    ).all(tenantId, targetId) as GraphEdgeRow[];
    return rows.map(rowToEntity);
  }

  async findByEdgeType(tenantId: TenantId, edgeType: GraphEdgeType): Promise<PolicyGraphEdge[]> {
    const rows = this.db.prepare(
      'SELECT * FROM graph_edges WHERE tenant_id = ? AND edge_type = ?',
    ).all(tenantId, edgeType) as GraphEdgeRow[];
    return rows.map(rowToEntity);
  }

  async findByTenant(tenantId: TenantId, filters?: GraphEdgeFilters): Promise<PolicyGraphEdge[]> {
    let sql = 'SELECT * FROM graph_edges WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filters) {
      if (filters.edgeType) { sql += ' AND edge_type = ?'; params.push(filters.edgeType); }
      if (filters.sourceId) { sql += ' AND source_id = ?'; params.push(filters.sourceId); }
      if (filters.targetId) { sql += ' AND target_id = ?'; params.push(filters.targetId); }
      if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
      if (filters.offset) {
        if (!filters.limit) { sql += ' LIMIT -1'; }
        sql += ' OFFSET ?'; params.push(filters.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as GraphEdgeRow[];
    return rows.map(rowToEntity);
  }
}
