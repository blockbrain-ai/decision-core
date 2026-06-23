/**
 * G-Brain Decision Store — Skill Implementation
 *
 * Provides the decision-query skill for retrieving prior decisions
 * from G-Brain memory. Used by agents to recall decision patterns.
 */

import {
  GBrainClient,
  GBrainContextAdapter,
  GBrainStoreAdapter,
  type GBrainTransport,
  type GBrainContext,
  type StoredPage,
} from '../../src/adapters/gbrain/index.js';

// ===========================================================================
// Skill Configuration
// ===========================================================================

export interface DecisionStoreConfig {
  transport: GBrainTransport;
  maxResults?: number;
}

// ===========================================================================
// Decision Store Skill
// ===========================================================================

export class DecisionStoreSkill {
  private readonly contextAdapter: GBrainContextAdapter;
  private readonly storeAdapter: GBrainStoreAdapter;

  constructor(config: DecisionStoreConfig) {
    const client = new GBrainClient({ transport: config.transport });
    this.contextAdapter = new GBrainContextAdapter({
      client,
      maxResults: config.maxResults,
    });
    this.storeAdapter = new GBrainStoreAdapter({ client });
  }

  /**
   * Query prior decisions from G-Brain memory.
   */
  async query(
    tenantId: string,
    surfaceId: string,
    action: string,
  ): Promise<GBrainContext> {
    return this.contextAdapter.getContext(tenantId, surfaceId, action);
  }

  /**
   * Store a decision in G-Brain memory after evaluation.
   */
  async store(
    tenantId: string,
    surfaceId: string,
    decisionId: string,
    decision: Record<string, unknown>,
    evidence?: Record<string, unknown>,
    entities?: string[],
  ): Promise<StoredPage> {
    return this.storeAdapter.storeDecision(
      tenantId,
      surfaceId,
      decisionId,
      decision,
      evidence,
      entities,
    );
  }
}
