/**
 * Policy Impact Analysis Service
 *
 * Analyzes the impact of proposed clause changes on the policy graph.
 * Conservative approach: if uncertain, include in the report.
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import { PolicyGraphQueryService } from './policy-graph-query.service.js';
import type { GraphEdgeRepository } from '../../persistence/interfaces/graph-edge.repository.js';
import type { EntityTypeResolver } from './policy-graph.service.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('policy-impact-analysis-service');

export interface ProposedChange {
  changeType: 'modify' | 'deactivate' | 'delete';
  description: string;
}

export interface ImpactReport {
  clauseId: string;
  tenantId: string;
  proposedChange: ProposedChange;
  affectedSurfaces: string[];
  conflictingClauses: string[];
  dependentClauses: string[];
  downstreamRules: string[];
  riskLevel: 'low' | 'medium' | 'high';
  recommendations: string[];
}

export class PolicyImpactAnalysisService {
  private readonly queryService: PolicyGraphQueryService;

  constructor(
    private readonly edgeRepository: GraphEdgeRepository,
    private readonly entityTypeResolver: EntityTypeResolver,
  ) {
    this.queryService = new PolicyGraphQueryService(edgeRepository);
  }

  async analyzeChange(
    tenantId: TenantId,
    clauseId: string,
    proposedChange: ProposedChange,
  ): Promise<ImpactReport> {
    const [affectedSurfaces, conflicts, dependents, downstreamRules] = await Promise.all([
      this.queryService.surfacesImpactedByClause(tenantId, clauseId),
      this.queryService.detectConflicts(tenantId, clauseId),
      this.findDependentClauses(tenantId, clauseId),
      this.findDownstreamRules(tenantId, clauseId),
    ]);

    const riskLevel = this.assessRisk(
      proposedChange,
      affectedSurfaces.length,
      conflicts.conflictsWith.length,
      dependents.length,
    );

    const recommendations = this.generateRecommendations(
      proposedChange,
      affectedSurfaces,
      conflicts.conflictsWith,
      dependents,
      riskLevel,
    );

    const report: ImpactReport = {
      clauseId,
      tenantId,
      proposedChange,
      affectedSurfaces,
      conflictingClauses: conflicts.conflictsWith,
      dependentClauses: dependents,
      downstreamRules,
      riskLevel,
      recommendations,
    };

    logger.info(
      { tenantId, clauseId, riskLevel, surfaceCount: affectedSurfaces.length },
      'Impact analysis completed',
    );

    return report;
  }

  private async findDependentClauses(tenantId: TenantId, clauseId: string): Promise<string[]> {
    const incoming = await this.edgeRepository.findByTarget(tenantId, clauseId);
    return incoming
      .filter((e) => e.edgeType === 'depends_on' || e.edgeType === 'inherits_from')
      .map((e) => e.sourceId);
  }

  private async findDownstreamRules(tenantId: TenantId, clauseId: string): Promise<string[]> {
    const outgoing = await this.edgeRepository.findBySource(tenantId, clauseId);
    const incoming = await this.edgeRepository.findByTarget(tenantId, clauseId);

    const candidateIds = new Set<string>();

    for (const edge of [...outgoing, ...incoming]) {
      if (edge.edgeType === 'depends_on' || edge.edgeType === 'triggers') {
        const otherId = edge.sourceId === clauseId ? edge.targetId : edge.sourceId;
        candidateIds.add(otherId);
      }
    }

    // Filter to only entities that are actually rules
    const ruleIds: string[] = [];
    for (const id of candidateIds) {
      const entityType = await this.entityTypeResolver.resolveEntityType(tenantId, id);
      if (entityType === 'rule') {
        ruleIds.push(id);
      }
    }

    return ruleIds;
  }

  private assessRisk(
    proposedChange: ProposedChange,
    surfaceCount: number,
    conflictCount: number,
    dependentCount: number,
  ): 'low' | 'medium' | 'high' {
    if (proposedChange.changeType === 'delete') {
      if (surfaceCount > 0 || dependentCount > 0) return 'high';
      return 'medium';
    }

    if (proposedChange.changeType === 'deactivate') {
      if (surfaceCount > 2 || dependentCount > 2) return 'high';
      if (surfaceCount > 0 || dependentCount > 0) return 'medium';
      return 'low';
    }

    // modify
    if (conflictCount > 0 && surfaceCount > 2) return 'high';
    if (surfaceCount > 2 || dependentCount > 2 || conflictCount > 0) return 'medium';
    return 'low';
  }

  private generateRecommendations(
    proposedChange: ProposedChange,
    affectedSurfaces: string[],
    conflictingClauses: string[],
    dependentClauses: string[],
    riskLevel: 'low' | 'medium' | 'high',
  ): string[] {
    const recommendations: string[] = [];

    if (riskLevel === 'high') {
      recommendations.push('Requires human review before proceeding');
    }

    if (affectedSurfaces.length > 0) {
      recommendations.push(
        `Review impact on ${affectedSurfaces.length} affected surface(s)`,
      );
    }

    if (conflictingClauses.length > 0) {
      recommendations.push(
        `Resolve ${conflictingClauses.length} existing conflict(s) before changing`,
      );
    }

    if (dependentClauses.length > 0 && proposedChange.changeType !== 'modify') {
      recommendations.push(
        `Update or review ${dependentClauses.length} dependent clause(s)`,
      );
    }

    if (proposedChange.changeType === 'delete' && dependentClauses.length > 0) {
      recommendations.push('Consider deactivation instead of deletion to preserve audit trail');
    }

    return recommendations;
  }
}
