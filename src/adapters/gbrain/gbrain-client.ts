/**
 * G-Brain Client Wrapper
 *
 * Abstraction over G-Brain's transport (MCP or direct SDK).
 * Provides search and put_page with client-side slug validation.
 */

import { createLogger } from '../../utils/logger.js';
import {
  SLUG_PREFIX,
  GBrainSlugSchema,
  type GBrainPage,
  type GBrainSearchParams,
  type GBrainPutPageParams,
} from './gbrain.contracts.js';

const logger = createLogger('gbrain-client');

// ===========================================================================
// Transport Interface
// ===========================================================================

export interface GBrainTransport {
  search(params: GBrainSearchParams): Promise<GBrainPage[]>;
  putPage(params: GBrainPutPageParams): Promise<GBrainPage>;
  getPage(slug: string): Promise<GBrainPage | null>;
}

// ===========================================================================
// Client Wrapper
// ===========================================================================

export interface GBrainClientOptions {
  transport: GBrainTransport;
  slugPrefix?: string;
}

export class GBrainClient {
  private readonly transport: GBrainTransport;
  private readonly slugPrefix: string;

  constructor(options: GBrainClientOptions) {
    this.transport = options.transport;
    this.slugPrefix = options.slugPrefix ?? SLUG_PREFIX;
  }

  async search(params: GBrainSearchParams): Promise<GBrainPage[]> {
    logger.debug({ params }, 'gbrain search');
    return this.transport.search({
      ...params,
      slugPrefix: params.slugPrefix ?? this.slugPrefix,
    });
  }

  async putPage(params: GBrainPutPageParams): Promise<GBrainPage> {
    this.validateSlug(params.slug);
    logger.debug({ slug: params.slug }, 'gbrain put_page');
    return this.transport.putPage(params);
  }

  async getPage(slug: string): Promise<GBrainPage | null> {
    logger.debug({ slug }, 'gbrain get_page');
    return this.transport.getPage(slug);
  }

  /**
   * Client-side slug validation.
   * Ensures all writes are scoped to the decisions/ prefix.
   */
  private validateSlug(slug: string): void {
    const result = GBrainSlugSchema.safeParse(slug);
    if (!result.success) {
      throw new Error(
        `Slug validation failed: slug "${slug}" must start with "${SLUG_PREFIX}"`,
      );
    }
  }
}
