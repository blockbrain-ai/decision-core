import { describe, it, expect } from 'vitest';
import {
  detectFrontmatter,
  parseFrontmatter,
  parseStructuredClauseBlocks,
  parseStructuredDocument,
} from './frontmatter-parser.js';

const VALID_DOC = `---
schema_version: "1.0.0"
policy_id: dc.finance.001
title: Finance Transaction Policy
owner: compliance@example.com
surfaces:
  - finance.processing
tags:
  - finance
  - compliance
---

# Finance Transaction Policy

All high-value transactions require approval.

\`\`\`decision-core-clause
clause_id: dc.finance.001.threshold
clause_type: threshold
condition:
  type: threshold
  field: amount
  operator: gte
  value: 10000
decision: approve_required
surface_id: finance.processing
route_class: deterministic_only
safe_to_execute_without_model: true
evidence_required:
  - amount
  - currency
rationale: Transactions >= $10,000 require human approval
owner: compliance@example.com
approval_required: true
priority: 100
\`\`\`

Some prose in between.

\`\`\`decision-core-clause
clause_id: dc.finance.001.sanctions
clause_type: prohibition
condition:
  type: sanctions_match
  field: recipient.country
  sanctionsLists:
    - OFAC
    - EU_SANCTIONS
decision: deny
surface_id: finance.processing
safe_to_execute_without_model: true
protected_attribute_review: false
\`\`\`
`;

describe('detectFrontmatter', () => {
  it('returns true for content with frontmatter', () => {
    expect(detectFrontmatter(VALID_DOC)).toBe(true);
  });

  it('returns false for plain markdown', () => {
    expect(detectFrontmatter('# No frontmatter here')).toBe(false);
  });

  it('returns true for content with leading whitespace', () => {
    expect(detectFrontmatter('  \n---\nfoo: bar\n---')).toBe(true);
  });
});

describe('parseFrontmatter', () => {
  it('extracts frontmatter and body', () => {
    const result = parseFrontmatter(VALID_DOC);
    expect(result.frontmatter.policy_id).toBe('dc.finance.001');
    expect(result.frontmatter.title).toBe('Finance Transaction Policy');
    expect(result.frontmatter.owner).toBe('compliance@example.com');
    expect(result.frontmatter.surfaces).toEqual(['finance.processing']);
    expect(result.frontmatter.tags).toEqual(['finance', 'compliance']);
    expect(result.body).toContain('# Finance Transaction Policy');
    expect(result.bodyStartLine).toBeGreaterThan(1);
  });

  it('throws on missing closing delimiter', () => {
    expect(() => parseFrontmatter('---\npolicy_id: x\n')).toThrow('Incomplete');
  });

  it('throws when content starts with non-delimiter', () => {
    expect(() => parseFrontmatter('hello\n---\npolicy_id: x\n---')).toThrow('Expected frontmatter');
  });

  it('applies schema defaults', () => {
    const result = parseFrontmatter('---\npolicy_id: minimal\n---\nbody');
    expect(result.frontmatter.schema_version).toBe('1.0.0');
  });
});

describe('parseStructuredClauseBlocks', () => {
  it('parses clause blocks from body with correct line refs', () => {
    const { body, bodyStartLine } = parseFrontmatter(VALID_DOC);
    const results = parseStructuredClauseBlocks(body, 'test.md', bodyStartLine);

    expect(results).toHaveLength(2);

    expect(results[0].clause.clause_id).toBe('dc.finance.001.threshold');
    expect(results[0].clause.clause_type).toBe('threshold');
    expect(results[0].clause.condition).toEqual({
      type: 'threshold',
      field: 'amount',
      operator: 'gte',
      value: 10000,
    });
    expect(results[0].clause.decision).toBe('approve_required');
    expect(results[0].clause.approval_required).toBe(true);
    expect(results[0].clause.evidence_required).toEqual(['amount', 'currency']);
    expect(results[0].sourceLineRef.file).toBe('test.md');
    expect(results[0].sourceLineRef.startLine).toBeGreaterThan(0);

    expect(results[1].clause.clause_id).toBe('dc.finance.001.sanctions');
    expect(results[1].clause.clause_type).toBe('prohibition');
    expect(results[1].clause.condition!.type).toBe('sanctions_match');
  });

  it('returns empty for body with no clause blocks', () => {
    const results = parseStructuredClauseBlocks('# Just prose\nNo clauses here.');
    expect(results).toHaveLength(0);
  });

  it('ignores non-decision-core fenced blocks', () => {
    const body = '```typescript\nconst x = 1;\n```\n\nSome text.';
    const results = parseStructuredClauseBlocks(body);
    expect(results).toHaveLength(0);
  });

  it('throws on unclosed clause block', () => {
    const body = '```decision-core-clause\nclause_id: x\nclause_type: general';
    expect(() => parseStructuredClauseBlocks(body)).toThrow('Unclosed');
  });
});

describe('parseStructuredDocument', () => {
  it('parses full document with frontmatter and clauses', () => {
    const { document, parsedClauses } = parseStructuredDocument(VALID_DOC, 'policy.md');

    expect(document.frontmatter.policy_id).toBe('dc.finance.001');
    expect(document.clauses).toHaveLength(2);
    expect(parsedClauses).toHaveLength(2);
    expect(parsedClauses[0].sourceLineRef.file).toBe('policy.md');
  });

  it('throws when document has no clauses', () => {
    const doc = '---\npolicy_id: empty\n---\n# No clauses';
    expect(() => parseStructuredDocument(doc)).toThrow();
  });
});
