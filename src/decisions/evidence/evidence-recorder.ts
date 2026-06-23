/**
 * Decision Evidence Recorder
 *
 * Records the full evidence chain for a decision execution.
 * Each step in the pipeline appends an evidence record to form
 * a tamper-evident audit chain (D3 standard).
 */

import type { TenantId, CorrelationId } from '../../contracts/common.contracts.js';
import type { EvidenceRecord } from '../../contracts/evidence.contracts.js';
import type { EventService } from '../../adapters/event-service.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import { hashCanonicalJson, hashChainEntry } from '../../utils/audit-hash.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('evidence-recorder');

export interface EvidenceStep {
  operationType: string;
  payload: Record<string, unknown>;
}

export interface EvidenceChainResult {
  records: EvidenceRecord[];
  headHash: string | null;
}

/**
 * Records an ordered chain of evidence steps for a single decision execution.
 * Each record's auditHash is derived from: sequence + previousHash + payloadHash + operationType.
 */
export class EvidenceRecorder {
  private records: EvidenceRecord[] = [];
  private headHash: string | null = null;

  constructor(
    private readonly tenantId: TenantId,
    private readonly correlationId: CorrelationId,
    private readonly eventService: EventService,
  ) {}

  append(step: EvidenceStep): EvidenceRecord {
    const sequence = this.records.length;
    const timestamp = new Date().toISOString();
    const payloadHash = hashCanonicalJson(step.payload);
    const auditHash = hashChainEntry({
      sequence,
      previousHash: this.headHash,
      payloadHash,
      operationType: step.operationType,
      timestamp,
    });

    const record: EvidenceRecord = {
      id: generateUuidV7(),
      correlationId: this.correlationId,
      timestamp,
      tenantId: this.tenantId,
      auditHash,
      operationType: step.operationType,
      payload: step.payload,
      sequence,
      previousHash: this.headHash,
    };

    this.records.push(record);
    this.headHash = auditHash;

    this.eventService.emit({
      id: generateUuidV7(),
      type: 'DECISION_EVIDENCE_APPENDED',
      source: 'evidence-recorder',
      payload: {
        operationType: step.operationType,
        sequence,
        auditHash,
      },
      timestamp: record.timestamp,
      correlationId: this.correlationId,
      tenantId: this.tenantId,
    });

    logger.debug(
      { correlationId: this.correlationId, operationType: step.operationType, sequence },
      'Evidence step recorded',
    );

    return record;
  }

  getResult(): EvidenceChainResult {
    return {
      records: [...this.records],
      headHash: this.headHash,
    };
  }
}
