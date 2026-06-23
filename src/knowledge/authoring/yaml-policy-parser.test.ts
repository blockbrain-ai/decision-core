import { describe, it, expect } from 'vitest';
import { parseYamlPolicy } from './yaml-policy-parser.js';

const VALID_YAML = `
frontmatter:
  schema_version: "1.0.0"
  policy_id: dc.data.001
  title: Data Extraction Policy
  surfaces:
    - data.extraction
clauses:
  - clause_id: dc.data.001.format
    clause_type: permission
    condition:
      type: enum_match
      field: format
      allowedValues: [csv, json, xml]
    decision: allow
    surface_id: data.extraction
    safe_to_execute_without_model: true
  - clause_id: dc.data.001.large
    clause_type: threshold
    condition:
      type: threshold
      field: row_count
      operator: gte
      value: 1000000
    decision: approve_required
    surface_id: data.extraction
    owner: data-team@example.com
    evidence_required:
      - row_count
      - source
`;

describe('parseYamlPolicy', () => {
  it('parses valid YAML policy', () => {
    const { document, parsedClauses } = parseYamlPolicy(VALID_YAML);

    expect(document.frontmatter.policy_id).toBe('dc.data.001');
    expect(document.frontmatter.title).toBe('Data Extraction Policy');
    expect(document.clauses).toHaveLength(2);

    expect(document.clauses[0].clause_id).toBe('dc.data.001.format');
    expect(document.clauses[0].condition).toEqual({
      type: 'enum_match',
      field: 'format',
      allowedValues: ['csv', 'json', 'xml'],
    });

    expect(document.clauses[1].clause_id).toBe('dc.data.001.large');
    expect(document.clauses[1].condition!.type).toBe('threshold');

    expect(parsedClauses).toHaveLength(2);
  });

  it('attaches filePath to source line refs', () => {
    const { parsedClauses } = parseYamlPolicy(VALID_YAML, '/path/to/policy.yaml');
    expect(parsedClauses[0].sourceLineRef.file).toBe('/path/to/policy.yaml');
    expect(parsedClauses[0].sourceLineRef.startLine).toBeGreaterThan(0);
    expect(parsedClauses[0].sourceLineRef.endLine).toBeGreaterThanOrEqual(parsedClauses[0].sourceLineRef.startLine);
    expect(parsedClauses[1].sourceLineRef.startLine).toBeGreaterThan(parsedClauses[0].sourceLineRef.startLine);
  });

  it('uses <inline> when no filePath given', () => {
    const { parsedClauses } = parseYamlPolicy(VALID_YAML);
    expect(parsedClauses[0].sourceLineRef.file).toBe('<inline>');
  });

  it('throws on invalid YAML structure', () => {
    expect(() => parseYamlPolicy('not: valid: yaml: policy')).toThrow();
  });

  it('throws when clauses array is empty', () => {
    const yaml = `
frontmatter:
  policy_id: empty
clauses: []
`;
    expect(() => parseYamlPolicy(yaml)).toThrow();
  });

  it('throws when frontmatter is missing', () => {
    const yaml = `
clauses:
  - clause_id: x
    clause_type: general
`;
    expect(() => parseYamlPolicy(yaml)).toThrow();
  });

  it('parses composite conditions', () => {
    const yaml = `
frontmatter:
  policy_id: dc.composite
clauses:
  - clause_id: dc.composite.001
    clause_type: obligation
    condition:
      type: composite_and
      rules:
        - type: threshold
          field: amount
          operator: gte
          value: 5000
        - type: enum_match
          field: currency
          allowedValues: [USD, EUR]
    decision: approve_required
`;
    const { document } = parseYamlPolicy(yaml);
    expect(document.clauses[0].condition!.type).toBe('composite_and');
  });
});
