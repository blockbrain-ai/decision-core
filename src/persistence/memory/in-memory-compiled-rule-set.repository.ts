/**
 * In-Memory Compiled Rule Set Repository
 *
 * Map-based implementation with tenant isolation (D2).
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type {
  CompiledRuleSet,
  CompiledRuleSetCreateInput,
} from '../../contracts/clause.contracts.js';
import type { CompiledRuleSetRepository } from '../interfaces/compiled-rule-set.repository.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import { hashCanonicalJson } from '../../utils/audit-hash.js';

export class InMemoryCompiledRuleSetRepository implements CompiledRuleSetRepository {
  private store = new Map<string, Map<string, CompiledRuleSet>>();

  private getTenantStore(tenantId: TenantId): Map<string, CompiledRuleSet> {
    let tenant = this.store.get(tenantId);
    if (!tenant) {
      tenant = new Map();
      this.store.set(tenantId, tenant);
    }
    return tenant;
  }

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
    this.getTenantStore(tenantId).set(id, ruleSet);
    return ruleSet;
  }

  async findById(tenantId: TenantId, id: string): Promise<CompiledRuleSet | null> {
    return this.getTenantStore(tenantId).get(id) ?? null;
  }

  async findActive(tenantId: TenantId): Promise<CompiledRuleSet | null> {
    const records = Array.from(this.getTenantStore(tenantId).values());
    return records.find((r) => r.status === 'active') ?? null;
  }

  async findByTenant(tenantId: TenantId): Promise<CompiledRuleSet[]> {
    return Array.from(this.getTenantStore(tenantId).values());
  }
}
