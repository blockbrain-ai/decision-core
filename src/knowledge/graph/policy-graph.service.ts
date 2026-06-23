/**
 * Policy Graph Service
 *
 * Creates and manages edges in the policy graph.
 * Validates edge types and entity constraints before persisting.
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type {
  PolicyGraphEdge,
  PolicyGraphEdgeCreateInput,
} from '../../contracts/clause.contracts.js';
import type { GraphEdgeRepository } from '../../persistence/interfaces/graph-edge.repository.js';
import { validateEdgeConstraints, type EntityType } from './edge-types.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('policy-graph-service');

export interface EntityTypeResolver {
  resolveEntityType(tenantId: TenantId, entityId: string): Promise<EntityType | null>;
}

export class PolicyGraphService {
  constructor(
    private readonly edgeRepository: GraphEdgeRepository,
    private readonly entityTypeResolver: EntityTypeResolver,
  ) {}

  async addEdge(tenantId: TenantId, input: PolicyGraphEdgeCreateInput): Promise<PolicyGraphEdge> {
    const sourceType = await this.entityTypeResolver.resolveEntityType(tenantId, input.sourceId);
    if (!sourceType) {
      throw new Error(`Source entity '${input.sourceId}' not found for tenant '${tenantId}'`);
    }

    const targetType = await this.entityTypeResolver.resolveEntityType(tenantId, input.targetId);
    if (!targetType) {
      throw new Error(`Target entity '${input.targetId}' not found for tenant '${tenantId}'`);
    }

    const validation = validateEdgeConstraints(input.edgeType, sourceType, targetType);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    const edge = await this.edgeRepository.create(tenantId, input);

    logger.info(
      { tenantId, edgeId: edge.id, edgeType: input.edgeType, sourceId: input.sourceId, targetId: input.targetId },
      'Graph edge created',
    );

    return edge;
  }

  async removeEdge(tenantId: TenantId, edgeId: string): Promise<boolean> {
    const deleted = await this.edgeRepository.delete(tenantId, edgeId);
    if (!deleted) {
      return false;
    }

    logger.info({ tenantId, edgeId }, 'Graph edge removed');
    return true;
  }

  async getEdgesBySource(tenantId: TenantId, sourceId: string): Promise<PolicyGraphEdge[]> {
    return this.edgeRepository.findBySource(tenantId, sourceId);
  }

  async getEdgesByTarget(tenantId: TenantId, targetId: string): Promise<PolicyGraphEdge[]> {
    return this.edgeRepository.findByTarget(tenantId, targetId);
  }
}
