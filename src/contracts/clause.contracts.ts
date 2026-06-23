/**
 * Clause Contract Types
 *
 * Complete Zod schemas for the clause/knowledge-graph system:
 * PolicySourceDocument, PolicyClause (12 types), PolicyControl,
 * PolicyGraphEdge (16 edge types).
 */

import { z } from 'zod';

// ===========================================================================
// Clause Types (12 enum values)
// ===========================================================================

export const CLAUSE_TYPES = [
  'obligation',
  'prohibition',
  'permission',
  'threshold',
  'exception',
  'definition',
  'evidence_requirement',
  'approval_requirement',
  'human_oversight_requirement',
  'protected_attribute_constraint',
  'routing_constraint',
  'general',
] as const;
export const ClauseTypeSchema = z.enum(CLAUSE_TYPES);
export type ClauseType = z.infer<typeof ClauseTypeSchema>;

// ===========================================================================
// Clause Status
// ===========================================================================

export const CLAUSE_STATUSES = ['draft', 'approved', 'active', 'superseded'] as const;
export const ClauseStatusSchema = z.enum(CLAUSE_STATUSES);
export type ClauseStatus = z.infer<typeof ClauseStatusSchema>;

// ===========================================================================
// Document Status
// ===========================================================================

export const DOCUMENT_STATUSES = ['importing', 'imported', 'failed', 'archived'] as const;
export const DocumentStatusSchema = z.enum(DOCUMENT_STATUSES);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

// ===========================================================================
// Policy Source Document
// ===========================================================================

export const PolicySourceDocumentSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string(),
  sourceHash: z.string(),
  sections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    order: z.number().int().nonnegative(),
  })),
  importedAt: z.string(),
  status: DocumentStatusSchema,
  correlationId: z.string(),
  auditHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PolicySourceDocument = z.infer<typeof PolicySourceDocumentSchema>;

export const PolicySourceDocumentCreateInputSchema = PolicySourceDocumentSchema.omit({
  id: true,
  tenantId: true,
  auditHash: true,
  createdAt: true,
  updatedAt: true,
});
export type PolicySourceDocumentCreateInput = z.infer<typeof PolicySourceDocumentCreateInputSchema>;

// ===========================================================================
// Policy Clause
// ===========================================================================

export const PolicyClauseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  clauseKey: z.string(),
  text: z.string(),
  normalizedHash: z.string(),
  clauseType: ClauseTypeSchema,
  sectionId: z.string(),
  sourceDocumentId: z.string(),
  status: ClauseStatusSchema,
  effectiveDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
  correlationId: z.string(),
  auditHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PolicyClause = z.infer<typeof PolicyClauseSchema>;

export const PolicyClauseCreateInputSchema = PolicyClauseSchema.omit({
  id: true,
  tenantId: true,
  normalizedHash: true,
  auditHash: true,
  createdAt: true,
  updatedAt: true,
});
export type PolicyClauseCreateInput = z.infer<typeof PolicyClauseCreateInputSchema>;

// ===========================================================================
// Policy Control
// ===========================================================================

export const CONTROL_TYPES = [
  'amount_threshold',
  'sanctions_hold',
  'dual_authorization_required',
  'evidence_field_required',
  'decision_label_forbidden',
] as const;
export const ControlTypeSchema = z.enum(CONTROL_TYPES);
export type ControlType = z.infer<typeof ControlTypeSchema>;

export const PolicyControlSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  clauseId: z.string(),
  controlType: ControlTypeSchema,
  parameters: z.record(z.unknown()),
  correlationId: z.string(),
  auditHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PolicyControl = z.infer<typeof PolicyControlSchema>;

export const PolicyControlCreateInputSchema = PolicyControlSchema.omit({
  id: true,
  tenantId: true,
  auditHash: true,
  createdAt: true,
  updatedAt: true,
});
export type PolicyControlCreateInput = z.infer<typeof PolicyControlCreateInputSchema>;

// ===========================================================================
// Graph Edge Types (16 types)
// ===========================================================================

export const GRAPH_EDGE_TYPES = [
  'depends_on',
  'conflicts_with',
  'supersedes',
  'refines',
  'exempts',
  'requires_evidence',
  'requires_approval',
  'constrains',
  'delegates_to',
  'inherits_from',
  'triggers',
  'blocks',
  'supplements',
  'narrows',
  'broadens',
  'cross_references',
] as const;
export const GraphEdgeTypeSchema = z.enum(GRAPH_EDGE_TYPES);
export type GraphEdgeType = z.infer<typeof GraphEdgeTypeSchema>;

// ===========================================================================
// Policy Graph Edge
// ===========================================================================

export const PolicyGraphEdgeSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  sourceId: z.string(),
  targetId: z.string(),
  edgeType: GraphEdgeTypeSchema,
  metadata: z.record(z.unknown()),
  correlationId: z.string(),
  auditHash: z.string(),
  createdAt: z.string(),
});
export type PolicyGraphEdge = z.infer<typeof PolicyGraphEdgeSchema>;

export const PolicyGraphEdgeCreateInputSchema = PolicyGraphEdgeSchema.omit({
  id: true,
  tenantId: true,
  auditHash: true,
  createdAt: true,
});
export type PolicyGraphEdgeCreateInput = z.infer<typeof PolicyGraphEdgeCreateInputSchema>;

// ===========================================================================
// Compiled Rule Set
// ===========================================================================

export const COMPILED_RULE_SET_STATUSES = ['compiling', 'active', 'inactive', 'failed'] as const;
export const CompiledRuleSetStatusSchema = z.enum(COMPILED_RULE_SET_STATUSES);
export type CompiledRuleSetStatus = z.infer<typeof CompiledRuleSetStatusSchema>;

export const CompiledRuleSetSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  version: z.number().int().positive(),
  status: CompiledRuleSetStatusSchema,
  clauseIds: z.array(z.string()),
  compiledAt: z.string(),
  activatedAt: z.string().nullable(),
  correlationId: z.string(),
  auditHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CompiledRuleSet = z.infer<typeof CompiledRuleSetSchema>;

export const CompiledRuleSetCreateInputSchema = CompiledRuleSetSchema.omit({
  id: true,
  tenantId: true,
  auditHash: true,
  createdAt: true,
  updatedAt: true,
});
export type CompiledRuleSetCreateInput = z.infer<typeof CompiledRuleSetCreateInputSchema>;
