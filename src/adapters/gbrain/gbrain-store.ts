/**
 * G-Brain Store Adapter
 *
 * Stores decisions as G-Brain pages with entity links after evaluation.
 * All writes are scoped to `decisions/<tenantId>/<surfaceId>/<decisionId>`.
 */

import { createLogger } from '../../utils/logger.js';
import type { GBrainClient } from './gbrain-client.js';
import type { StoredPage } from './gbrain.contracts.js';

const logger = createLogger('gbrain-store');

export interface GBrainStoreAdapterOptions {
  client: GBrainClient;
}

export interface StoreDecisionInput {
  surface?: string;
  toolName?: string;
  status?: string;
  [key: string]: unknown;
}

export interface StoreEvidenceInput {
  correlationId?: string;
  [key: string]: unknown;
}

export class GBrainStoreAdapter {
  private readonly client: GBrainClient;

  constructor(options: GBrainStoreAdapterOptions) {
    this.client = options.client;
  }

  async storeDecision(
    tenantId: string,
    surfaceId: string,
    decisionId: string,
    decision: StoreDecisionInput,
    evidence?: StoreEvidenceInput,
    entities?: string[],
  ): Promise<StoredPage> {
    const slug = `decisions/${tenantId}/${surfaceId}/${decisionId}`;
    const title = `Decision: ${decision.toolName ?? decision.surface ?? decisionId}`;
    const content = JSON.stringify({ decision, evidence }, null, 2);
    const resolvedEntities = entities ?? this.extractEntities(decision, evidence);

    logger.debug({ slug, entities: resolvedEntities }, 'storing decision in gbrain');

    const page = await this.client.putPage({
      slug,
      title,
      content,
      entities: resolvedEntities,
      metadata: {
        tenantId,
        surfaceId,
        decisionId,
        status: decision.status,
        correlationId: evidence?.correlationId,
      },
    });

    const stored: StoredPage = {
      slug: page.slug,
      title: page.title,
      createdAt: page.createdAt ?? new Date().toISOString(),
      entities: page.entities ?? resolvedEntities,
    };

    logger.debug({ slug: stored.slug }, 'decision stored in gbrain');
    return stored;
  }

  private extractEntities(
    decision: StoreDecisionInput,
    evidence?: StoreEvidenceInput,
  ): string[] {
    const entities: string[] = [];
    if (decision.surface) entities.push(decision.surface);
    if (decision.toolName) entities.push(decision.toolName);
    if (evidence?.correlationId) entities.push(evidence.correlationId);
    return entities;
  }
}
