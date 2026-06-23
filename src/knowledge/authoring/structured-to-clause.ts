import type { ExtractedClause } from '../ingestion/policy-clause-extractor.js';
import type { RuleExpression } from '../compiler/policy-rule-expression.types.js';
import type { PolicyFrontmatter, StructuredClauseBlock, ParsedStructuredClause, SourceLineRef } from './structured-clause.types.js';

// ===========================================================================
// Structured Compiler Input
// ===========================================================================

export interface StructuredCompilerInput {
  clauseId: string;
  clauseType: StructuredClauseBlock['clause_type'];
  expression: RuleExpression;
  surfaceId?: string;
  routeClass?: string;
  safeToExecuteWithoutModel?: boolean;
  confidenceFloor?: number;
  evidenceRequired?: string[];
  sourceLineRef: SourceLineRef;
  decision?: string;
  owner?: string;
  approvalRequired?: boolean;
  protectedAttributeReview?: boolean;
  authoringSchemaVersion?: string;
}

// ===========================================================================
// Converter
// ===========================================================================

export interface StructuredConversionResult {
  extractedClauses: ExtractedClause[];
  compilerInputs: StructuredCompilerInput[];
}

export function convertStructuredClauses(
  parsedClauses: ParsedStructuredClause[],
  frontmatter?: PolicyFrontmatter,
): StructuredConversionResult {
  const extractedClauses: ExtractedClause[] = [];
  const compilerInputs: StructuredCompilerInput[] = [];

  for (let index = 0; index < parsedClauses.length; index++) {
    const { clause, sourceLineRef } = parsedClauses[index]!;
    const surfaceId = clause.surface_id ?? frontmatter?.surfaces?.[0];

    const extracted: ExtractedClause = {
      text: clause.source_text ?? clause.rationale ?? `[structured] ${clause.clause_id}`,
      clauseType: clause.clause_type,
      sectionId: frontmatter?.policy_id ?? clause.clause_id,
      headingPath: frontmatter?.title ?? clause.clause_id,
      indexInSection: index,
      confidence: 1.0,
    };
    extractedClauses.push(extracted);

    if (clause.condition) {
      compilerInputs.push({
        clauseId: clause.clause_id,
        clauseType: clause.clause_type,
        expression: clause.condition,
        surfaceId,
        routeClass: clause.route_class,
        safeToExecuteWithoutModel: clause.safe_to_execute_without_model,
        confidenceFloor: clause.confidence_floor,
        evidenceRequired: clause.evidence_required,
        sourceLineRef,
        decision: clause.decision,
        owner: clause.owner,
        approvalRequired: clause.approval_required,
        protectedAttributeReview: clause.protected_attribute_review,
        authoringSchemaVersion: frontmatter?.schema_version,
      });
    }
  }

  return { extractedClauses, compilerInputs };
}
