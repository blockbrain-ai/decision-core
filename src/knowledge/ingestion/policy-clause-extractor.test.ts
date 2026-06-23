import { describe, it, expect } from 'vitest';
import { extractClauses } from './policy-clause-extractor.js';
import type { ParsedSection } from './policy-section-parser.js';

function makeSection(overrides?: Partial<ParsedSection>): ParsedSection {
  return {
    id: 'section-0',
    title: 'Test Section',
    headingPath: 'Root > Test Section',
    level: 2,
    order: 0,
    content: '',
    contentHash: 'abc123',
    ...overrides,
  };
}

describe('PolicyClauseExtractor', () => {
  describe('obligation patterns', () => {
    it('detects "must" obligations', () => {
      const sections = [makeSection({ content: 'Staff must verify customer identity before processing.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('obligation');
    });

    it('detects "shall" obligations', () => {
      const sections = [makeSection({ content: 'Managers shall review flagged transactions.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('obligation');
    });

    it('detects "required to" obligations', () => {
      const sections = [makeSection({ content: 'Officers are required to report suspicious activity.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('obligation');
    });
  });

  describe('prohibition patterns', () => {
    it('detects "must not" prohibitions', () => {
      const sections = [makeSection({ content: 'Staff must not override automated holds.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('prohibition');
    });

    it('detects "shall not" prohibitions', () => {
      const sections = [makeSection({ content: 'Accounts shall not be closed without review.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('prohibition');
    });

    it('detects "forbidden" prohibitions', () => {
      const sections = [makeSection({ content: 'Processing from sanctioned jurisdictions is forbidden.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('prohibition');
    });

    it('detects "prohibited" prohibitions', () => {
      const sections = [makeSection({ content: 'Unauthorized access is prohibited under all circumstances.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('prohibition');
    });
  });

  describe('threshold patterns', () => {
    it('detects dollar amount thresholds', () => {
      const sections = [makeSection({ content: 'All transactions exceeding $10,000 must be reported.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('threshold');
    });

    it('detects "more than N" patterns', () => {
      const sections = [makeSection({ content: 'If transactions are more than 5 per day, flag the account.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('threshold');
    });
  });

  describe('permission patterns', () => {
    it('detects "may" permissions', () => {
      const sections = [makeSection({ content: 'Transactions below $500 may be processed without additional checks.' })];
      const clauses = extractClauses(sections);

      // This matches threshold first due to $500 pattern
      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('threshold');
    });

    it('detects pure "may" permissions without threshold', () => {
      const sections = [makeSection({ content: 'Junior staff may delegate tasks to interns.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('permission');
    });
  });

  describe('evidence requirement patterns', () => {
    it('detects "evidence of" patterns', () => {
      const sections = [makeSection({ content: 'Evidence of identity verification must be retained for 7 years.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('evidence_requirement');
    });

    it('detects "proof of" patterns', () => {
      const sections = [makeSection({ content: 'Proof of address is needed for account opening.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('evidence_requirement');
    });

    it('detects "documentation required" patterns', () => {
      const sections = [makeSection({ content: 'Documentation required for any account opened for a foreign national.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('evidence_requirement');
    });
  });

  describe('approval requirement patterns', () => {
    it('detects "must be approved" patterns', () => {
      const sections = [makeSection({ content: 'New PEP accounts must be approved by the Head of Compliance.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('approval_requirement');
    });

    it('detects "approval required" patterns', () => {
      const sections = [makeSection({ content: 'Approval required for any exception to standard due diligence.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('approval_requirement');
    });
  });

  describe('human oversight patterns', () => {
    it('detects "human oversight" patterns', () => {
      const sections = [makeSection({ content: 'Automated decisions must have human oversight within 48 hours.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('human_oversight_requirement');
    });

    it('detects "human reviewer is required" patterns', () => {
      const sections = [makeSection({ content: 'A human reviewer is required for account termination decisions.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('human_oversight_requirement');
    });
  });

  describe('routing constraint patterns', () => {
    it('detects "shall be routed" patterns', () => {
      const sections = [makeSection({ content: 'High-value decisions shall be routed to the senior review panel.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('routing_constraint');
    });

    it('detects "must be routed" patterns', () => {
      const sections = [makeSection({ content: 'Complex decisions must be routed to the senior panel.' })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.clauseType).toBe('routing_constraint');
    });
  });

  describe('bullet lists', () => {
    it('extracts clauses from bullet items', () => {
      const content = `- Staff must verify identity.
- All suspicious activity must be documented.
- Managers shall review flagged transactions.`;
      const sections = [makeSection({ content })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(3);
      expect(clauses.every((c) => c.clauseType === 'obligation')).toBe(true);
    });
  });

  describe('tables', () => {
    it('extracts clauses from table rows with policy language', () => {
      const content = `| Rule | Condition | Limit |
|------|-----------|-------|
| Report required | Transaction exceeds $10,000 | Must report within 24h |
| Enhanced review | Amount above $25,000 | Must escalate to compliance |`;
      const sections = [makeSection({ content })];
      const clauses = extractClauses(sections);

      expect(clauses.length).toBeGreaterThan(0);
    });

    it('skips table rows without policy patterns', () => {
      const content = `| Name | Value |
|------|-------|
| Alpha | 100 |
| Beta | 200 |`;
      const sections = [makeSection({ content })];
      const clauses = extractClauses(sections);

      expect(clauses).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for empty content', () => {
      const sections = [makeSection({ content: '' })];
      const clauses = extractClauses(sections);
      expect(clauses).toHaveLength(0);
    });

    it('returns empty array for content without policy patterns', () => {
      const sections = [makeSection({ content: 'This is just a general description with no obligations.' })];
      const clauses = extractClauses(sections);
      expect(clauses).toHaveLength(0);
    });

    it('returns empty array for empty sections list', () => {
      const clauses = extractClauses([]);
      expect(clauses).toHaveLength(0);
    });

    it('assigns sequential indexInSection values', () => {
      const content = `- Staff must verify identity.
- All activity must be documented.
- Managers shall review flags.`;
      const sections = [makeSection({ content })];
      const clauses = extractClauses(sections);

      expect(clauses[0]!.indexInSection).toBe(0);
      expect(clauses[1]!.indexInSection).toBe(1);
      expect(clauses[2]!.indexInSection).toBe(2);
    });
  });
});
