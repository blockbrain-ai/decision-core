/**
 * Enforcement Module
 *
 * Runtime enforcement integration: wires compiled rules from the clause graph
 * into the decision runner's enforcement pipeline.
 */

export type { ClauseEvidence, EnforcementResult, DeterministicEnforcer, DeterministicEnforcerDeps } from './deterministic-enforcer.js';
export { createDeterministicEnforcer } from './deterministic-enforcer.js';

export type { ClauseProvenancePayload, ClauseEvidenceRecorder } from './clause-evidence-recorder.js';
export { createClauseEvidenceRecorder } from './clause-evidence-recorder.js';

export type { EnforcementFlowOutcome, EnforcementFlowResult, EnforcementFlow, EnforcementFlowDeps } from './enforcement-flow.js';
export { createEnforcementFlow } from './enforcement-flow.js';

export { ProvenanceMetadataSchema, COMPILER_VERSION, buildProvenanceMetadata } from './provenance-metadata.js';
export type { ProvenanceMetadata, BuildProvenanceOptions } from './provenance-metadata.js';
