/**
 * G-Brain Context Adapter
 *
 * Retrieves relevant context from G-Brain before decision evaluation.
 * Searches for prior decisions, entity pages, and patterns.
 */

import { createLogger } from '../../utils/logger.js';
import type { GBrainClient } from './gbrain-client.js';
import type { GBrainContext, GBrainContextRequest } from './gbrain.contracts.js';

const logger = createLogger('gbrain-context');

const DEFAULT_MAX_RESULTS = 10;

export interface GBrainContextAdapterOptions {
  client: GBrainClient;
  maxResults?: number;
}

export class GBrainContextAdapter {
  private readonly client: GBrainClient;
  private readonly maxResults: number;

  constructor(options: GBrainContextAdapterOptions) {
    this.client = options.client;
    this.maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  }

  async getContext(
    tenantId: string,
    surfaceId: string,
    action: string,
  ): Promise<GBrainContext> {
    const query = `${surfaceId} ${action}`;
    const slugPrefix = `decisions/${tenantId}/`;

    logger.debug({ tenantId, surfaceId, action, query }, 'retrieving gbrain context');

    const pages = await this.client.search({
      query,
      slugPrefix,
      limit: this.maxResults,
    });

    const context: GBrainContext = {
      pages,
      query,
      totalResults: pages.length,
    };

    logger.debug({ totalResults: context.totalResults }, 'gbrain context retrieved');
    return context;
  }

  /**
   * Typed variant accepting a full request object.
   */
  async getContextFromRequest(request: GBrainContextRequest): Promise<GBrainContext> {
    return this.getContext(
      request.tenantId,
      request.surfaceId,
      request.action,
    );
  }

  /**
   * Retrieve strategic context (OKRs, goals, direction) for decision alignment.
   */
  async getStrategicContext(tenantId: string): Promise<GBrainContext> {
    const slugPrefix = `strategy/`;

    logger.debug({ tenantId }, 'retrieving strategic context');

    const pages = await this.client.search({
      query: 'OKRs goals strategy objectives',
      slugPrefix,
      limit: this.maxResults,
    });

    return {
      pages,
      query: 'strategic-context',
      totalResults: pages.length,
    };
  }
}
