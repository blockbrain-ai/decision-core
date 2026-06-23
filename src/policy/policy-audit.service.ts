/**
 * Policy Audit Service
 *
 * Records audit entries for every policy evaluation.
 * Each entry carries correlationId, timestamp, tenantId,
 * and auditHash per D3 standard.
 */

import type { TenantId } from '../contracts/common.contracts.js';
import type { PolicyAuditEntry, VerdictResult } from '../contracts/policy.contracts.js';
import type { EventService } from '../adapters/event-service.js';
import { generateUuidV7 } from '../utils/uuid-v7.js';
import { hashCanonicalJson } from '../utils/audit-hash.js';
import { createLogger } from '../utils/logger.js';
import { POLICY_EVENTS } from './policy.events.js';

const logger = createLogger('policy-audit');

export interface AuditEntryInput {
  ruleId: string;
  ruleName: string;
  actionType: string;
  verdict: VerdictResult;
  reason: string;
  correlationId: string;
  tenantId: TenantId;
}

export class PolicyAuditService {
  private readonly entries: PolicyAuditEntry[] = [];

  constructor(private readonly eventService: EventService) {}

  record(input: AuditEntryInput): PolicyAuditEntry {
    const timestamp = new Date().toISOString();
    const id = generateUuidV7();

    const entry: PolicyAuditEntry = {
      id,
      ruleId: input.ruleId,
      ruleName: input.ruleName,
      actionType: input.actionType,
      verdict: input.verdict,
      reason: input.reason,
      timestamp,
      correlationId: input.correlationId,
      tenantId: input.tenantId,
      auditHash: hashCanonicalJson({
        id,
        ruleId: input.ruleId,
        actionType: input.actionType,
        verdict: input.verdict,
        timestamp,
        correlationId: input.correlationId,
        tenantId: input.tenantId,
      }),
    };

    this.entries.push(entry);

    this.eventService.emit({
      id: generateUuidV7(),
      type: POLICY_EVENTS.POLICY_EVALUATED,
      source: 'policy-audit',
      payload: {
        ruleId: entry.ruleId,
        actionType: entry.actionType,
        verdict: entry.verdict,
      },
      timestamp,
      correlationId: input.correlationId,
      tenantId: input.tenantId,
    });

    logger.debug({ entry }, 'Policy audit entry recorded');

    return entry;
  }

  getEntries(tenantId: TenantId): PolicyAuditEntry[] {
    return this.entries.filter((e) => e.tenantId === tenantId);
  }

  getEntriesByCorrelation(tenantId: TenantId, correlationId: string): PolicyAuditEntry[] {
    return this.entries.filter((e) => e.tenantId === tenantId && e.correlationId === correlationId);
  }
}
