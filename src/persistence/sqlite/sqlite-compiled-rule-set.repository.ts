/**
 * SQLite Compiled Rule Set Repository
 *
 * better-sqlite3 implementation with tenant isolation (D2).
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { CompiledRuleSet, CompiledRuleSetCreateInput } from '../../contracts/clause.contracts.js';
import type { CompiledRuleSetRepository } from '../interfaces/compiled-rule-set.repository.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import { hashCanonicalJson } from '../../utils/audit-hash.js';

interface CompiledRuleSetRow {
  id: string;
  tenant_id: string;
  name: string;
  version: number;
  status: string;
  clause_ids: string;
  compiled_at: string;
  activated_at: string | null;
  correlation_id: string;
  audit_hash: string;
  created_at: string;
  updated_at: string;
}

function rowToEntity(row: CompiledRuleSetRow): CompiledRuleSet {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    version: row.version,
    status: row.status as CompiledRuleSet['status'],
    clauseIds: JSON.parse(row.clause_ids) as string[],
    compiledAt: row.compiled_at,
    activatedAt: row.activated_at,
    correlationId: row.correlation_id,
    auditHash: row.audit_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteCompiledRuleSetRepository implements CompiledRuleSetRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  async create(tenantId: TenantId, input: CompiledRuleSetCreateInput): Promise<CompiledRuleSet> {
    const now = new Date().toISOString();
    const id = generateUuidV7();
    const ruleSet: CompiledRuleSet = {
      ...input,
      id,
      tenantId,
      auditHash: hashCanonicalJson({ id, ...input, tenantId }),
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO compiled_rule_sets (
        id, tenant_id, name, version, status, clause_ids,
        compiled_at, activated_at, correlation_id, audit_hash,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, ruleSet.name, ruleSet.version, ruleSet.status,
      JSON.stringify(ruleSet.clauseIds), ruleSet.compiledAt,
      ruleSet.activatedAt, ruleSet.correlationId, ruleSet.auditHash,
      now, now,
    );

    return ruleSet;
  }

  async findById(tenantId: TenantId, id: string): Promise<CompiledRuleSet | null> {
    const row = this.db.prepare(
      'SELECT * FROM compiled_rule_sets WHERE id = ? AND tenant_id = ?',
    ).get(id, tenantId) as CompiledRuleSetRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findActive(tenantId: TenantId): Promise<CompiledRuleSet | null> {
    const row = this.db.prepare(
      'SELECT * FROM compiled_rule_sets WHERE tenant_id = ? AND status = ? LIMIT 1',
    ).get(tenantId, 'active') as CompiledRuleSetRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findByTenant(tenantId: TenantId): Promise<CompiledRuleSet[]> {
    const rows = this.db.prepare(
      'SELECT * FROM compiled_rule_sets WHERE tenant_id = ?',
    ).all(tenantId) as CompiledRuleSetRow[];
    return rows.map(rowToEntity);
  }
}
