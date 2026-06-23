/**
 * SQLite Event Repository
 *
 * Append-only better-sqlite3 implementation with tenant isolation (D2).
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { DomainEvent, EventFilters, EventRepository } from '../interfaces/event.repository.js';

interface EventRow {
  id: string;
  tenant_id: string;
  type: string;
  source: string;
  payload: string;
  timestamp: string;
  correlation_id: string;
}

function rowToEntity(row: EventRow): DomainEvent {
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    timestamp: row.timestamp,
    correlationId: row.correlation_id,
    tenantId: row.tenant_id,
  };
}

export class SqliteEventRepository implements EventRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  async append(tenantId: TenantId, event: DomainEvent): Promise<DomainEvent> {
    this.db.prepare(`
      INSERT INTO events (id, tenant_id, type, source, payload, timestamp, correlation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id, tenantId, event.type, event.source,
      JSON.stringify(event.payload), event.timestamp, event.correlationId,
    );
    return event;
  }

  async findById(tenantId: TenantId, id: string): Promise<DomainEvent | null> {
    const row = this.db.prepare(
      'SELECT * FROM events WHERE id = ? AND tenant_id = ?',
    ).get(id, tenantId) as EventRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findAll(tenantId: TenantId, filters?: EventFilters): Promise<DomainEvent[]> {
    let sql = 'SELECT * FROM events WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filters) {
      if (filters.type) { sql += ' AND type = ?'; params.push(filters.type); }
      if (filters.source) { sql += ' AND source = ?'; params.push(filters.source); }
      if (filters.correlationId) { sql += ' AND correlation_id = ?'; params.push(filters.correlationId); }
      if (filters.from) { sql += ' AND timestamp >= ?'; params.push(filters.from); }
      if (filters.to) { sql += ' AND timestamp <= ?'; params.push(filters.to); }
      if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
      if (filters.offset) {
        if (!filters.limit) { sql += ' LIMIT -1'; }
        sql += ' OFFSET ?'; params.push(filters.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as EventRow[];
    return rows.map(rowToEntity);
  }

  async findByCorrelationId(tenantId: TenantId, correlationId: string): Promise<DomainEvent[]> {
    const rows = this.db.prepare(
      'SELECT * FROM events WHERE tenant_id = ? AND correlation_id = ?',
    ).all(tenantId, correlationId) as EventRow[];
    return rows.map(rowToEntity);
  }

  async count(tenantId: TenantId, filters?: EventFilters): Promise<number> {
    const all = await this.findAll(tenantId, filters ? { ...filters, limit: undefined, offset: undefined } : undefined);
    return all.length;
  }
}
