/**
 * SQLite Policy Rule Repository
 *
 * better-sqlite3 implementation with tenant isolation (D2).
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyRule, PolicyRuleCreateInput, PolicyRuleFilters } from '../../contracts/policy.contracts.js';
import type { PolicyRuleRepository } from '../interfaces/policy-rule.repository.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import { globMatches } from '../../policy/glob-matcher.js';

interface PolicyRuleRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  action_type_pattern: string;
  risk_class: string;
  enforcement_point: string;
  policy_type: string;
  priority: number;
  max_amount_usd: number | null;
  max_count_per_day: number | null;
  cooldown_minutes: number | null;
  time_window_start: string | null;
  time_window_end: string | null;
  min_data_quality: number | null;
  min_confidence: number | null;
  required_constraints: string;
  require_approval: number;
  default_verdict: string | null;
  required_roles: string | null;
  role_match_mode: string | null;
  approver_role: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToEntity(row: PolicyRuleRow): PolicyRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    actionTypePattern: row.action_type_pattern,
    riskClass: row.risk_class as PolicyRule['riskClass'],
    enforcementPoint: row.enforcement_point as PolicyRule['enforcementPoint'],
    policyType: row.policy_type as PolicyRule['policyType'],
    priority: row.priority,
    maxAmountUsd: row.max_amount_usd ?? undefined,
    maxCountPerDay: row.max_count_per_day ?? undefined,
    cooldownMinutes: row.cooldown_minutes ?? undefined,
    timeWindowStart: row.time_window_start ?? undefined,
    timeWindowEnd: row.time_window_end ?? undefined,
    minDataQuality: row.min_data_quality ?? undefined,
    minConfidence: row.min_confidence ?? undefined,
    requiredConstraints: JSON.parse(row.required_constraints) as string[],
    requireApproval: row.require_approval === 1,
    defaultVerdict: (row.default_verdict as PolicyRule['defaultVerdict']) ?? undefined,
    requiredRoles: row.required_roles ? JSON.parse(row.required_roles) as string[] : undefined,
    roleMatchMode: (row.role_match_mode as PolicyRule['roleMatchMode']) ?? undefined,
    approverRole: row.approver_role ?? undefined,
    enabled: row.enabled === 1,
    tenantId: row.tenant_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqlitePolicyRuleRepository implements PolicyRuleRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  async create(tenantId: TenantId, input: PolicyRuleCreateInput): Promise<PolicyRule> {
    const now = new Date().toISOString();
    const id = generateUuidV7();
    const rule: PolicyRule = {
      ...input,
      id,
      requiredConstraints: input.requiredConstraints ?? [],
      tenantId,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO policy_rules (
        id, tenant_id, name, description, action_type_pattern, risk_class,
        enforcement_point, policy_type, priority, max_amount_usd, max_count_per_day,
        cooldown_minutes, time_window_start, time_window_end, min_data_quality,
        min_confidence, required_constraints, require_approval, default_verdict,
        required_roles, role_match_mode, approver_role, enabled,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).run(
      id, tenantId, rule.name, rule.description, rule.actionTypePattern,
      rule.riskClass, rule.enforcementPoint, rule.policyType, rule.priority,
      rule.maxAmountUsd ?? null, rule.maxCountPerDay ?? null,
      rule.cooldownMinutes ?? null, rule.timeWindowStart ?? null,
      rule.timeWindowEnd ?? null, rule.minDataQuality ?? null,
      rule.minConfidence ?? null, JSON.stringify(rule.requiredConstraints),
      rule.requireApproval ? 1 : 0, rule.defaultVerdict ?? null,
      rule.requiredRoles ? JSON.stringify(rule.requiredRoles) : null,
      rule.roleMatchMode ?? null, rule.approverRole ?? null,
      rule.enabled ? 1 : 0,
      now, now,
    );

    return rule;
  }

  async findById(tenantId: TenantId, id: string): Promise<PolicyRule | null> {
    const row = this.db.prepare(
      'SELECT * FROM policy_rules WHERE id = ? AND tenant_id = ?',
    ).get(id, tenantId) as PolicyRuleRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findAll(tenantId: TenantId, filters?: PolicyRuleFilters): Promise<PolicyRule[]> {
    let sql = 'SELECT * FROM policy_rules WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filters) {
      if (filters.policyType) { sql += ' AND policy_type = ?'; params.push(filters.policyType); }
      if (filters.riskClass) { sql += ' AND risk_class = ?'; params.push(filters.riskClass); }
      if (filters.enforcementPoint) { sql += ' AND enforcement_point = ?'; params.push(filters.enforcementPoint); }
      if (filters.enabled !== undefined) { sql += ' AND enabled = ?'; params.push(filters.enabled ? 1 : 0); }
      if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
      if (filters.offset) {
        if (!filters.limit) { sql += ' LIMIT -1'; }
        sql += ' OFFSET ?'; params.push(filters.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as PolicyRuleRow[];
    return rows.map(rowToEntity);
  }

  async findByActionType(tenantId: TenantId, actionType: string): Promise<PolicyRule[]> {
    const rows = this.db.prepare(
      'SELECT * FROM policy_rules WHERE tenant_id = ?',
    ).all(tenantId) as PolicyRuleRow[];

    return rows
      .filter((r) => globMatches(r.action_type_pattern, actionType))
      .map(rowToEntity);
  }

  async update(tenantId: TenantId, id: string, input: Partial<PolicyRuleCreateInput>): Promise<PolicyRule | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) return null;

    const updated: PolicyRule = {
      ...existing,
      ...input,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.db.prepare(`
      UPDATE policy_rules SET
        name = ?, description = ?, action_type_pattern = ?, risk_class = ?,
        enforcement_point = ?, policy_type = ?, priority = ?, max_amount_usd = ?,
        max_count_per_day = ?, cooldown_minutes = ?, time_window_start = ?,
        time_window_end = ?, min_data_quality = ?, min_confidence = ?,
        required_constraints = ?, require_approval = ?, default_verdict = ?,
        required_roles = ?, role_match_mode = ?, approver_role = ?,
        enabled = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(
      updated.name, updated.description, updated.actionTypePattern, updated.riskClass,
      updated.enforcementPoint, updated.policyType, updated.priority,
      updated.maxAmountUsd ?? null, updated.maxCountPerDay ?? null,
      updated.cooldownMinutes ?? null, updated.timeWindowStart ?? null,
      updated.timeWindowEnd ?? null, updated.minDataQuality ?? null,
      updated.minConfidence ?? null, JSON.stringify(updated.requiredConstraints),
      updated.requireApproval ? 1 : 0, updated.defaultVerdict ?? null,
      updated.requiredRoles ? JSON.stringify(updated.requiredRoles) : null,
      updated.roleMatchMode ?? null, updated.approverRole ?? null,
      updated.enabled ? 1 : 0, updated.updatedAt,
      id, tenantId,
    );

    return updated;
  }

  async delete(tenantId: TenantId, id: string): Promise<boolean> {
    const result = this.db.prepare(
      'DELETE FROM policy_rules WHERE id = ? AND tenant_id = ?',
    ).run(id, tenantId);
    return result.changes > 0;
  }

  async count(tenantId: TenantId, filters?: PolicyRuleFilters): Promise<number> {
    const all = await this.findAll(tenantId, filters ? { ...filters, limit: undefined, offset: undefined } : undefined);
    return all.length;
  }
}
