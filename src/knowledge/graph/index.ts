export { PolicyGraphService } from './policy-graph.service.js';
export type { EntityTypeResolver } from './policy-graph.service.js';

export { PolicyGraphQueryService } from './policy-graph-query.service.js';
export type { GraphNeighbourhood, ConflictResult } from './policy-graph-query.service.js';

export { PolicyImpactAnalysisService } from './policy-impact-analysis.service.js';
export type { ProposedChange, ImpactReport } from './policy-impact-analysis.service.js';

export { ENTITY_TYPES, EDGE_TYPE_CONSTRAINTS, validateEdgeConstraints } from './edge-types.js';
export type { EntityType, EdgeTypeConstraint } from './edge-types.js';
