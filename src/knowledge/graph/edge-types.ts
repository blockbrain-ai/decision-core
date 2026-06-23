/**
 * Edge Type Definitions
 *
 * 16 typed edge definitions with source/target entity constraints.
 * Each edge type specifies which entity types are valid as source and target.
 */

import type { GraphEdgeType } from '../../contracts/clause.contracts.js';

export const ENTITY_TYPES = [
  'clause',
  'surface',
  'regulation',
  'field',
  'rule',
  'decision_label',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export interface EdgeTypeConstraint {
  edgeType: GraphEdgeType;
  validSources: EntityType[];
  validTargets: EntityType[];
  description: string;
}

export const EDGE_TYPE_CONSTRAINTS: Record<GraphEdgeType, EdgeTypeConstraint> = {
  depends_on: {
    edgeType: 'depends_on',
    validSources: ['clause', 'rule'],
    validTargets: ['clause', 'rule'],
    description: 'Source depends on target for enforcement',
  },
  conflicts_with: {
    edgeType: 'conflicts_with',
    validSources: ['clause'],
    validTargets: ['clause'],
    description: 'Source clause conflicts with target clause',
  },
  supersedes: {
    edgeType: 'supersedes',
    validSources: ['clause'],
    validTargets: ['clause'],
    description: 'Source clause supersedes target clause',
  },
  refines: {
    edgeType: 'refines',
    validSources: ['clause'],
    validTargets: ['clause'],
    description: 'Source clause refines/specializes target clause',
  },
  exempts: {
    edgeType: 'exempts',
    validSources: ['clause'],
    validTargets: ['clause', 'rule'],
    description: 'Source clause provides exemption from target',
  },
  requires_evidence: {
    edgeType: 'requires_evidence',
    validSources: ['clause'],
    validTargets: ['field'],
    description: 'Clause requires this evidence field',
  },
  requires_approval: {
    edgeType: 'requires_approval',
    validSources: ['clause', 'surface'],
    validTargets: ['clause', 'surface'],
    description: 'Source requires approval as defined by target',
  },
  constrains: {
    edgeType: 'constrains',
    validSources: ['clause'],
    validTargets: ['surface', 'decision_label'],
    description: 'Clause constrains the target surface or decision label',
  },
  delegates_to: {
    edgeType: 'delegates_to',
    validSources: ['clause'],
    validTargets: ['clause', 'surface'],
    description: 'Source delegates authority to target',
  },
  inherits_from: {
    edgeType: 'inherits_from',
    validSources: ['clause', 'rule'],
    validTargets: ['clause', 'regulation'],
    description: 'Source inherits requirements from target',
  },
  triggers: {
    edgeType: 'triggers',
    validSources: ['clause'],
    validTargets: ['clause', 'rule', 'surface'],
    description: 'Source triggers activation of target',
  },
  blocks: {
    edgeType: 'blocks',
    validSources: ['clause'],
    validTargets: ['clause', 'surface', 'decision_label'],
    description: 'Source blocks target from proceeding',
  },
  supplements: {
    edgeType: 'supplements',
    validSources: ['clause'],
    validTargets: ['clause', 'regulation'],
    description: 'Source supplements target with additional requirements',
  },
  narrows: {
    edgeType: 'narrows',
    validSources: ['clause'],
    validTargets: ['clause'],
    description: 'Source narrows scope of target',
  },
  broadens: {
    edgeType: 'broadens',
    validSources: ['clause'],
    validTargets: ['clause'],
    description: 'Source broadens scope of target',
  },
  cross_references: {
    edgeType: 'cross_references',
    validSources: ['clause', 'regulation'],
    validTargets: ['clause', 'regulation'],
    description: 'Source cross-references target for context',
  },
};

export function validateEdgeConstraints(
  edgeType: GraphEdgeType,
  sourceEntityType: EntityType,
  targetEntityType: EntityType,
): { valid: boolean; reason?: string } {
  const constraint = EDGE_TYPE_CONSTRAINTS[edgeType];

  if (!constraint.validSources.includes(sourceEntityType)) {
    return {
      valid: false,
      reason: `Edge type '${edgeType}' does not allow source entity type '${sourceEntityType}'. Valid sources: ${constraint.validSources.join(', ')}`,
    };
  }

  if (!constraint.validTargets.includes(targetEntityType)) {
    return {
      valid: false,
      reason: `Edge type '${edgeType}' does not allow target entity type '${targetEntityType}'. Valid targets: ${constraint.validTargets.join(', ')}`,
    };
  }

  return { valid: true };
}
