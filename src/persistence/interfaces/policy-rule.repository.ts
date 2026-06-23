/**
 * Policy Rule Repository Interface
 *
 * CRUD operations for policy rules, scoped by tenantId (D2).
 */

import type { PolicyRule, PolicyRuleCreateInput, PolicyRuleFilters } from '../../contracts/policy.contracts.js';
import type { TenantId } from '../../contracts/common.contracts.js';

export interface PolicyRuleRepository {
  create(tenantId: TenantId, input: PolicyRuleCreateInput): Promise<PolicyRule>;
  findById(tenantId: TenantId, id: string): Promise<PolicyRule | null>;
  findAll(tenantId: TenantId, filters?: PolicyRuleFilters): Promise<PolicyRule[]>;
  findByActionType(tenantId: TenantId, actionType: string): Promise<PolicyRule[]>;
  update(tenantId: TenantId, id: string, input: Partial<PolicyRuleCreateInput>): Promise<PolicyRule | null>;
  delete(tenantId: TenantId, id: string): Promise<boolean>;
  count(tenantId: TenantId, filters?: PolicyRuleFilters): Promise<number>;
}
