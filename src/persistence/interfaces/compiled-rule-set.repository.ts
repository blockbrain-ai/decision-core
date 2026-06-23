/**
 * CompiledRuleSetRepository Interface
 *
 * Persistence interface for CompiledRuleSet entities.
 * All methods take tenantId as first parameter (D2 standard).
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type {
  CompiledRuleSet,
  CompiledRuleSetCreateInput,
} from '../../contracts/clause.contracts.js';

export interface CompiledRuleSetRepository {
  create(tenantId: TenantId, input: CompiledRuleSetCreateInput): Promise<CompiledRuleSet>;
  findById(tenantId: TenantId, id: string): Promise<CompiledRuleSet | null>;
  findActive(tenantId: TenantId): Promise<CompiledRuleSet | null>;
  findByTenant(tenantId: TenantId): Promise<CompiledRuleSet[]>;
}
