import { z } from 'zod';
import { ClauseTypeSchema } from '../../contracts/clause.contracts.js';
import { RuleExpressionSchema } from '../compiler/policy-rule-expression.types.js';
import { RouteClassEnum } from '../../routing/types/route-class.js';

// ===========================================================================
// Source Line Reference
// ===========================================================================

export const SourceLineRefSchema = z.object({
  file: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});
export type SourceLineRef = z.infer<typeof SourceLineRefSchema>;

// ===========================================================================
// Structured Clause Block
// ===========================================================================

export const StructuredClauseBlockSchema = z.object({
  clause_id: z.string().min(1),
  clause_type: ClauseTypeSchema,
  condition: RuleExpressionSchema.optional(),
  decision: z.string().optional(),
  surface_id: z.string().optional(),
  route_class: RouteClassEnum.optional(),
  safe_to_execute_without_model: z.boolean().optional(),
  confidence_floor: z.number().min(0).max(1).optional(),
  evidence_required: z.array(z.string()).optional(),
  rationale: z.string().optional(),
  source_text: z.string().optional(),
  owner: z.string().optional(),
  approval_required: z.boolean().optional(),
  priority: z.number().int().optional(),
  effective_date: z.string().optional(),
  expiry_date: z.string().optional(),
  protected_attribute_review: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});
export type StructuredClauseBlock = z.infer<typeof StructuredClauseBlockSchema>;

// ===========================================================================
// Policy Frontmatter
// ===========================================================================

export const PolicyFrontmatterSchema = z.object({
  schema_version: z.string().default('1.0.0'),
  policy_id: z.string().min(1),
  title: z.string().optional(),
  owner: z.string().optional(),
  effective_date: z.string().optional(),
  surfaces: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});
export type PolicyFrontmatter = z.infer<typeof PolicyFrontmatterSchema>;

// ===========================================================================
// Structured Policy Document
// ===========================================================================

export const StructuredPolicyDocumentSchema = z.object({
  frontmatter: PolicyFrontmatterSchema,
  clauses: z.array(StructuredClauseBlockSchema).min(1),
});
export type StructuredPolicyDocument = z.infer<typeof StructuredPolicyDocumentSchema>;

// ===========================================================================
// Parsed Clause with Source Lines
// ===========================================================================

export interface ParsedStructuredClause {
  clause: StructuredClauseBlock;
  sourceLineRef: SourceLineRef;
}
