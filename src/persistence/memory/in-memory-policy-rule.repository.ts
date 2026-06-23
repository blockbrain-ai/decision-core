/**
 * In-Memory Policy Rule Repository
 *
 * Map-based implementation with tenant isolation (D2).
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyRule, PolicyRuleCreateInput, PolicyRuleFilters } from '../../contracts/policy.contracts.js';
import type { PolicyRuleRepository } from '../interfaces/policy-rule.repository.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import { globMatches } from '../../policy/glob-matcher.js';

export class InMemoryPolicyRuleRepository implements PolicyRuleRepository {
  private store = new Map<string, Map<string, PolicyRule>>();

  private getTenantStore(tenantId: TenantId): Map<string, PolicyRule> {
    let tenant = this.store.get(tenantId);
    if (!tenant) {
      tenant = new Map();
      this.store.set(tenantId, tenant);
    }
    return tenant;
  }

  async create(tenantId: TenantId, input: PolicyRuleCreateInput): Promise<PolicyRule> {
    const now = new Date().toISOString();
    const rule: PolicyRule = {
      ...input,
      id: generateUuidV7(),
      requiredConstraints: input.requiredConstraints ?? [],
      tenantId,
      createdAt: now,
      updatedAt: now,
    };
    this.getTenantStore(tenantId).set(rule.id, rule);
    return rule;
  }

  async findById(tenantId: TenantId, id: string): Promise<PolicyRule | null> {
    return this.getTenantStore(tenantId).get(id) ?? null;
  }

  async findAll(tenantId: TenantId, filters?: PolicyRuleFilters): Promise<PolicyRule[]> {
    let rules = Array.from(this.getTenantStore(tenantId).values());

    if (filters) {
      if (filters.policyType) rules = rules.filter((r) => r.policyType === filters.policyType);
      if (filters.riskClass) rules = rules.filter((r) => r.riskClass === filters.riskClass);
      if (filters.enforcementPoint) rules = rules.filter((r) => r.enforcementPoint === filters.enforcementPoint);
      if (filters.enabled !== undefined) rules = rules.filter((r) => r.enabled === filters.enabled);
      if (filters.offset) rules = rules.slice(filters.offset);
      if (filters.limit) rules = rules.slice(0, filters.limit);
    }

    return rules;
  }

  async findByActionType(tenantId: TenantId, actionType: string): Promise<PolicyRule[]> {
    return Array.from(this.getTenantStore(tenantId).values())
      .filter((r) => globMatches(r.actionTypePattern, actionType));
  }

  async update(tenantId: TenantId, id: string, input: Partial<PolicyRuleCreateInput>): Promise<PolicyRule | null> {
    const store = this.getTenantStore(tenantId);
    const existing = store.get(id);
    if (!existing) return null;

    const updated: PolicyRule = {
      ...existing,
      ...input,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    store.set(id, updated);
    return updated;
  }

  async delete(tenantId: TenantId, id: string): Promise<boolean> {
    return this.getTenantStore(tenantId).delete(id);
  }

  async count(tenantId: TenantId, filters?: PolicyRuleFilters): Promise<number> {
    const all = await this.findAll(tenantId, filters ? { ...filters, limit: undefined, offset: undefined } : undefined);
    return all.length;
  }
}
