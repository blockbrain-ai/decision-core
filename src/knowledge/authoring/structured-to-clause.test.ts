import { describe, it, expect } from 'vitest';
import { convertStructuredClauses } from './structured-to-clause.js';
import type { ParsedStructuredClause, PolicyFrontmatter } from './structured-clause.types.js';

const THRESHOLD_CLAUSE: ParsedStructuredClause = {
  clause: {
    clause_id: 'dc.fin.001',
    clause_type: 'threshold',
    condition: { type: 'threshold', field: 'amount', operator: 'gte', value: 10000 },
    decision: 'approve_required',
    surface_id: 'finance.processing',
    route_class: 'deterministic_only',
    safe_to_execute_without_model: true,
    evidence_required: ['amount', 'currency'],
    rationale: 'High-value transactions need approval',
    owner: 'compliance@example.com',
    approval_required: true,
    protected_attribute_review: false,
  },
  sourceLineRef: { file: 'test.md', startLine: 10, endLine: 25 },
};

const NO_CONDITION_CLAUSE: ParsedStructuredClause = {
  clause: {
    clause_id: 'dc.gen.001',
    clause_type: 'general',
    source_text: 'All employees must follow the code of conduct.',
  },
  sourceLineRef: { file: 'test.md', startLine: 30, endLine: 35 },
};

const FRONTMATTER: PolicyFrontmatter = {
  schema_version: '1.0.0',
  policy_id: 'dc.finance.policy',
  title: 'Finance Policy',
  surfaces: ['finance.processing'],
  tags: ['finance'],
};

describe('convertStructuredClauses', () => {
  it('produces ExtractedClause with confidence 1.0', () => {
    const { extractedClauses } = convertStructuredClauses([THRESHOLD_CLAUSE], FRONTMATTER);
    expect(extractedClauses).toHaveLength(1);
    expect(extractedClauses[0].confidence).toBe(1.0);
    expect(extractedClauses[0].clauseType).toBe('threshold');
    expect(extractedClauses[0].sectionId).toBe('dc.finance.policy');
    expect(extractedClauses[0].headingPath).toBe('Finance Policy');
  });

  it('produces StructuredCompilerInput for clauses with conditions', () => {
    const { compilerInputs } = convertStructuredClauses([THRESHOLD_CLAUSE], FRONTMATTER);
    expect(compilerInputs).toHaveLength(1);
    expect(compilerInputs[0].clauseId).toBe('dc.fin.001');
    expect(compilerInputs[0].expression).toEqual({
      type: 'threshold',
      field: 'amount',
      operator: 'gte',
      value: 10000,
    });
    expect(compilerInputs[0].surfaceId).toBe('finance.processing');
    expect(compilerInputs[0].routeClass).toBe('deterministic_only');
    expect(compilerInputs[0].sourceLineRef.startLine).toBe(10);
    expect(compilerInputs[0].approvalRequired).toBe(true);
    expect(compilerInputs[0].protectedAttributeReview).toBe(false);
  });

  it('does not produce compiler input for clauses without condition', () => {
    const { extractedClauses, compilerInputs } = convertStructuredClauses([NO_CONDITION_CLAUSE], FRONTMATTER);
    expect(extractedClauses).toHaveLength(1);
    expect(compilerInputs).toHaveLength(0);
  });

  it('falls back to frontmatter surface when clause has no surface_id', () => {
    const clauseNoSurface: ParsedStructuredClause = {
      clause: {
        clause_id: 'dc.nosurface.001',
        clause_type: 'obligation',
        condition: { type: 'boolean_required', field: 'approved', requiredValue: true },
        decision: 'deny',
      },
      sourceLineRef: { file: 'test.md', startLine: 1, endLine: 5 },
    };
    const { compilerInputs } = convertStructuredClauses([clauseNoSurface], FRONTMATTER);
    expect(compilerInputs[0].surfaceId).toBe('finance.processing');
  });

  it('uses clause_id as sectionId when no frontmatter', () => {
    const { extractedClauses } = convertStructuredClauses([THRESHOLD_CLAUSE]);
    expect(extractedClauses[0].sectionId).toBe('dc.fin.001');
  });

  it('handles multiple clauses', () => {
    const { extractedClauses, compilerInputs } = convertStructuredClauses(
      [THRESHOLD_CLAUSE, NO_CONDITION_CLAUSE],
      FRONTMATTER,
    );
    expect(extractedClauses).toHaveLength(2);
    expect(extractedClauses[0].indexInSection).toBe(0);
    expect(extractedClauses[1].indexInSection).toBe(1);
    expect(compilerInputs).toHaveLength(1);
  });

  it('uses source_text for ExtractedClause text when available', () => {
    const { extractedClauses } = convertStructuredClauses([NO_CONDITION_CLAUSE]);
    expect(extractedClauses[0].text).toBe('All employees must follow the code of conduct.');
  });

  it('falls back to rationale when no source_text', () => {
    const { extractedClauses } = convertStructuredClauses([THRESHOLD_CLAUSE]);
    expect(extractedClauses[0].text).toBe('High-value transactions need approval');
  });

  it('carries authoring schema version into compiler inputs', () => {
    const { compilerInputs } = convertStructuredClauses([THRESHOLD_CLAUSE], FRONTMATTER);
    expect(compilerInputs[0].authoringSchemaVersion).toBe('1.0.0');
  });
});
