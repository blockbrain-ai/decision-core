/**
 * Policy Graph Query Service
 *
 * Graph traversal queries: clauses-for-surface, surfaces-impacted-by-clause,
 * clause-neighbourhood, and conflict detection.
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyGraphEdge, PolicyClause } from '../../contracts/clause.contracts.js';
import type { GraphEdgeRepository } from '../../persistence/interfaces/graph-edge.repository.js';
import type { ClauseRepository } from '../../persistence/interfaces/clause.repository.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('policy-graph-query-service');

export interface GraphNeighbourhood {
  centerId: string;
  edges: PolicyGraphEdge[];
  nodeIds: string[];
  depth: number;
}

export interface ConflictResult {
  clauseId: string;
  conflictsWith: string[];
  edges: PolicyGraphEdge[];
}

export class PolicyGraphQueryService {
  constructor(
    private readonly edgeRepository: GraphEdgeRepository,
    private readonly clauseRepository?: ClauseRepository,
  ) {}

  /**
   * Find all clauses that apply to a given surface via 'constrains', 'blocks',
   * or 'triggers' edges where the target is the surface.
   */
  async clausesForSurface(tenantId: TenantId, surfaceId: string): Promise<PolicyClause[]> {
    const edges = await this.edgeRepository.findByTarget(tenantId, surfaceId);
    const clauseIds = [
      ...new Set(
        edges
          .filter((e) => e.edgeType === 'constrains' || e.edgeType === 'blocks' || e.edgeType === 'triggers')
          .map((e) => e.sourceId),
      ),
    ];

    if (!this.clauseRepository) {
      throw new Error('ClauseRepository is required for clausesForSurface');
    }

    const clauses: PolicyClause[] = [];
    for (const clauseId of clauseIds) {
      const clause = await this.clauseRepository.findById(tenantId, clauseId);
      if (clause) {
        clauses.push(clause);
      }
    }

    logger.debug({ tenantId, surfaceId, count: clauses.length }, 'Clauses for surface queried');
    return clauses;
  }

  /**
   * Find all surface IDs impacted by a given clause.
   * Traverses outgoing edges from the clause to find surfaces,
   * and follows transitive clause relationships to discover indirect impacts.
   */
  async surfacesImpactedByClause(tenantId: TenantId, clauseId: string): Promise<string[]> {
    const surfaceIds = new Set<string>();
    const visited = new Set<string>();
    const queue: string[] = [clauseId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const outgoing = await this.edgeRepository.findBySource(tenantId, currentId);

      for (const edge of outgoing) {
        if (edge.edgeType === 'constrains' || edge.edgeType === 'blocks' || edge.edgeType === 'triggers') {
          surfaceIds.add(edge.targetId);
        } else if (
          edge.edgeType === 'depends_on' ||
          edge.edgeType === 'refines' ||
          edge.edgeType === 'narrows' ||
          edge.edgeType === 'broadens' ||
          edge.edgeType === 'supersedes'
        ) {
          if (!visited.has(edge.targetId)) {
            queue.push(edge.targetId);
          }
        }
      }

      // Also check reverse edges — clauses that depend on this one
      const incoming = await this.edgeRepository.findByTarget(tenantId, currentId);
      for (const edge of incoming) {
        if (
          edge.edgeType === 'depends_on' ||
          edge.edgeType === 'refines' ||
          edge.edgeType === 'narrows' ||
          edge.edgeType === 'broadens'
        ) {
          if (!visited.has(edge.sourceId)) {
            queue.push(edge.sourceId);
          }
        }
      }
    }

    logger.debug({ tenantId, clauseId, count: surfaceIds.size }, 'Surfaces impacted by clause queried');
    return [...surfaceIds];
  }

  /**
   * BFS traversal from a clause to find all connected entities within depth N.
   */
  async clauseNeighbourhood(
    tenantId: TenantId,
    clauseId: string,
    depth: number = 2,
  ): Promise<GraphNeighbourhood> {
    const allEdges: PolicyGraphEdge[] = [];
    const nodeIds = new Set<string>();
    const visited = new Set<string>();

    interface QueueItem { id: string; currentDepth: number }
    const queue: QueueItem[] = [{ id: clauseId, currentDepth: 0 }];

    nodeIds.add(clauseId);

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift()!;
      if (visited.has(id) || currentDepth >= depth) continue;
      visited.add(id);

      const outgoing = await this.edgeRepository.findBySource(tenantId, id);
      const incoming = await this.edgeRepository.findByTarget(tenantId, id);

      for (const edge of [...outgoing, ...incoming]) {
        if (!allEdges.some((e) => e.id === edge.id)) {
          allEdges.push(edge);
        }

        const neighbour = edge.sourceId === id ? edge.targetId : edge.sourceId;
        nodeIds.add(neighbour);

        if (!visited.has(neighbour) && currentDepth + 1 < depth) {
          queue.push({ id: neighbour, currentDepth: currentDepth + 1 });
        }
      }
    }

    logger.debug(
      { tenantId, clauseId, depth, edgeCount: allEdges.length, nodeCount: nodeIds.size },
      'Clause neighbourhood queried',
    );

    return {
      centerId: clauseId,
      edges: allEdges,
      nodeIds: [...nodeIds],
      depth,
    };
  }

  /**
   * Detect conflicts for a given clause by finding CLAUSE_CONFLICTS_WITH_CLAUSE edges.
   */
  async detectConflicts(tenantId: TenantId, clauseId: string): Promise<ConflictResult> {
    const outgoing = await this.edgeRepository.findBySource(tenantId, clauseId);
    const incoming = await this.edgeRepository.findByTarget(tenantId, clauseId);

    const conflictEdges = [
      ...outgoing.filter((e) => e.edgeType === 'conflicts_with'),
      ...incoming.filter((e) => e.edgeType === 'conflicts_with'),
    ];

    const conflictsWith = conflictEdges.map((e) =>
      e.sourceId === clauseId ? e.targetId : e.sourceId,
    );

    logger.debug(
      { tenantId, clauseId, conflictCount: conflictsWith.length },
      'Conflict detection complete',
    );

    return {
      clauseId,
      conflictsWith: [...new Set(conflictsWith)],
      edges: conflictEdges,
    };
  }
}
