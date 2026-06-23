/**
 * Policy Author Service Tests
 *
 * Tests natural language → policy rule generation, ambiguity handling,
 * review workflow, and the critical negative control: rules are never auto-activated.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyAuthorService } from './policy-author.service.js';

describe('PolicyAuthorService', () => {
  let service: PolicyAuthorService;

  beforeEach(() => {
    service = new PolicyAuthorService();
  });

  // =========================================================================
  // Text-to-Policy: Common phrase patterns
  // =========================================================================

  describe('authorFromText — deny patterns', () => {
    it('generates deny rule for "nobody should drop the database"', () => {
      const result = service.authorFromText({
        naturalLanguage: 'nobody should drop the database',
      });

      expect(result.candidateRules).toHaveLength(1);
      const rule = result.candidateRules[0];
      expect(rule.ruleType).toBe('deny');
      expect(rule.confidence).toBe('high');
      expect(rule.yamlContent).toContain('db.drop');
      expect(rule.yamlContent).toContain('enabled: false');
      expect(rule.explanation).toContain('Blocks');
    });

    it('generates deny rule for "never delete production data"', () => {
      const result = service.authorFromText({
        naturalLanguage: 'never delete production data',
      });

      expect(result.candidateRules).toHaveLength(1);
      const rule = result.candidateRules[0];
      expect(rule.yamlContent).toContain('*.delete');
      expect(rule.yamlContent).toContain('enabled: false');
    });

    it('generates deny rule for "must not access the database"', () => {
      const result = service.authorFromText({
        naturalLanguage: 'agents must not access the database directly',
      });

      expect(result.candidateRules).toHaveLength(1);
      expect(result.candidateRules[0].yamlContent).toContain('db.*');
    });
  });

  describe('authorFromText — approval patterns', () => {
    it('generates approve_required rule for "emails need approval"', () => {
      const result = service.authorFromText({
        naturalLanguage: 'emails to clients need approval if more than 50 recipients',
      });

      // Should match the approval pattern (it has both approval and threshold triggers)
      expect(result.candidateRules.length).toBeGreaterThanOrEqual(1);
      const rule = result.candidateRules[0];
      expect(rule.yamlContent).toContain('requireApproval: true');
      expect(rule.yamlContent).toContain('enabled: false');
    });

    it('generates approve_required for "requires sign-off"', () => {
      const result = service.authorFromText({
        naturalLanguage: 'deployment to production requires sign-off',
      });

      expect(result.candidateRules).toHaveLength(1);
      const rule = result.candidateRules[0];
      expect(rule.yamlContent).toContain('requireApproval: true');
      expect(rule.yamlContent).toContain('deploy.*');
    });
  });

  describe('authorFromText — threshold patterns', () => {
    it('generates threshold rule for financial amounts', () => {
      const result = service.authorFromText({
        naturalLanguage: 'payments over $1000 need approval',
      });

      expect(result.candidateRules.length).toBeGreaterThanOrEqual(1);
      const rule = result.candidateRules[0];
      expect(rule.yamlContent).toContain('payment.*');
      expect(rule.yamlContent).toContain('enabled: false');
    });

    it('generates threshold rule for "more than N"', () => {
      const result = service.authorFromText({
        naturalLanguage: 'if more than 100 API calls per day, require approval',
      });

      expect(result.candidateRules.length).toBeGreaterThanOrEqual(1);
      const rule = result.candidateRules[0];
      expect(rule.yamlContent).toContain('enabled: false');
    });
  });

  describe('authorFromText — role-based patterns', () => {
    it('generates role-based rule for "only admins can access"', () => {
      const result = service.authorFromText({
        naturalLanguage: 'only admins can access financial reports',
      });

      expect(result.candidateRules).toHaveLength(1);
      const rule = result.candidateRules[0];
      expect(rule.yamlContent).toContain('report.financial');
      expect(rule.explanation).toContain('admins');
      expect(rule.yamlContent).toContain('enabled: false');
      expect(rule.ruleType).toBe('role_based');
    });
  });

  describe('authorFromText — rate limit patterns', () => {
    it('generates rate limit rule for "no more than N per day"', () => {
      const result = service.authorFromText({
        naturalLanguage: 'no more than 10 deployments per day',
      });

      expect(result.candidateRules).toHaveLength(1);
      const rule = result.candidateRules[0];
      expect(rule.yamlContent).toContain('maxCountPerDay: 10');
      expect(rule.yamlContent).toContain('deploy.*');
      expect(rule.yamlContent).toContain('enabled: false');
    });
  });

  // =========================================================================
  // NEGATIVE CONTROL: rules never auto-activate
  // =========================================================================

  describe('negative control — rules never auto-activate', () => {
    it('all generated rules have enabled: false', () => {
      const inputs = [
        'nobody should drop the database',
        'emails need approval',
        'only admins can access reports',
        'payments over $500 need review',
        'no more than 5 deploys per day',
      ];

      for (const input of inputs) {
        const result = service.authorFromText({ naturalLanguage: input });
        for (const rule of result.candidateRules) {
          expect(rule.yamlContent).toContain('enabled: false');
          expect(rule.yamlContent).not.toContain('enabled: true');
        }
      }
    });

    it('committed rules still have enabled: false', () => {
      const result = service.authorFromText({
        naturalLanguage: 'nobody should drop the database',
      });

      const ruleId = result.candidateRules[0].id;
      const sessionId = result.sessionId;

      // Accept and commit
      service.reviewRule(sessionId, { ruleId, action: 'accept' });
      const committed = service.commitRules(sessionId);

      expect(committed.policiesYaml).toContain('enabled: false');
      expect(committed.policiesYaml).not.toContain('enabled: true');
    });

    it('status is always draft on generation', () => {
      const result = service.authorFromText({
        naturalLanguage: 'nobody should drop the database',
      });

      for (const rule of result.candidateRules) {
        expect(['draft', 'needs_human_policy_authoring']).toContain(rule.status);
        expect(rule.status).not.toBe('accepted');
        expect(rule.status).not.toBe('active');
      }
    });
  });

  // =========================================================================
  // Ambiguity Detection
  // =========================================================================

  describe('ambiguity detection', () => {
    it('marks ambiguous input as needs_human_policy_authoring', () => {
      const result = service.authorFromText({
        naturalLanguage: 'make it more secure',
      });

      expect(result.candidateRules).toHaveLength(1);
      expect(result.candidateRules[0].status).toBe('needs_human_policy_authoring');
      expect(result.ambiguities.length).toBeGreaterThan(0);
    });

    it('does not generate actionable rules from vague input', () => {
      const result = service.authorFromText({
        naturalLanguage: 'things should be better',
      });

      for (const rule of result.candidateRules) {
        expect(rule.status).toBe('needs_human_policy_authoring');
      }
    });

    it('flags wildcard patterns with low confidence', () => {
      const result = service.authorFromText({
        naturalLanguage: 'never do anything bad',
      });

      expect(result.candidateRules).toHaveLength(1);
      const rule = result.candidateRules[0];
      // Since "never" triggers deny but no specific tool → wildcard → low confidence → needs_human
      expect(rule.status).toBe('needs_human_policy_authoring');
      expect(result.ambiguities.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Review Workflow
  // =========================================================================

  describe('review workflow', () => {
    it('accepts a rule', () => {
      const result = service.authorFromText({
        naturalLanguage: 'nobody should drop the database',
      });

      const ruleId = result.candidateRules[0].id;
      const sessionId = result.sessionId;

      const reviewed = service.reviewRule(sessionId, { ruleId, action: 'accept' });
      expect(reviewed.status).toBe('accepted');
    });

    it('rejects a rule', () => {
      const result = service.authorFromText({
        naturalLanguage: 'nobody should drop the database',
      });

      const ruleId = result.candidateRules[0].id;
      const sessionId = result.sessionId;

      const reviewed = service.reviewRule(sessionId, { ruleId, action: 'reject' });
      expect(reviewed.status).toBe('rejected');
    });

    it('modifies a rule with new YAML', () => {
      const result = service.authorFromText({
        naturalLanguage: 'nobody should drop the database',
      });

      const ruleId = result.candidateRules[0].id;
      const sessionId = result.sessionId;
      const modifiedYaml = '  - name: "Custom deny rule"\n    actionTypePattern: "db.drop_table"\n    enabled: false';

      const reviewed = service.reviewRule(sessionId, {
        ruleId,
        action: 'modify',
        modifiedYaml,
      });
      expect(reviewed.status).toBe('accepted');
      expect(reviewed.yamlContent).toBe(modifiedYaml);
    });

    it('throws if modify action lacks modifiedYaml', () => {
      const result = service.authorFromText({
        naturalLanguage: 'nobody should drop the database',
      });

      const ruleId = result.candidateRules[0].id;
      const sessionId = result.sessionId;

      expect(() =>
        service.reviewRule(sessionId, { ruleId, action: 'modify' }),
      ).toThrow('modifiedYaml is required');
    });

    it('throws for invalid session ID', () => {
      expect(() =>
        service.reviewRule('nonexistent', { ruleId: 'x', action: 'accept' }),
      ).toThrow('Session not found');
    });

    it('throws for invalid rule ID', () => {
      const result = service.authorFromText({
        naturalLanguage: 'nobody should drop the database',
      });

      const sessionId = result.sessionId;

      expect(() =>
        service.reviewRule(sessionId, { ruleId: 'nonexistent', action: 'accept' }),
      ).toThrow('Rule not found');
    });
  });

  // =========================================================================
  // Commit
  // =========================================================================

  describe('commitRules', () => {
    it('commits accepted rules as YAML', () => {
      const result = service.authorFromText({
        naturalLanguage: 'nobody should drop the database',
      });

      const ruleId = result.candidateRules[0].id;
      const sessionId = result.sessionId;

      service.reviewRule(sessionId, { ruleId, action: 'accept' });
      const committed = service.commitRules(sessionId);

      expect(committed.committedRuleIds).toContain(ruleId);
      expect(committed.policiesYaml).toContain('rules:');
      expect(committed.policiesYaml).toContain('db.');
      expect(committed.policiesYaml).toContain('enabled: false');
    });

    it('returns empty result when no rules accepted', () => {
      const result = service.authorFromText({
        naturalLanguage: 'nobody should drop the database',
      });

      const ruleId = result.candidateRules[0].id;
      const sessionId = result.sessionId;

      service.reviewRule(sessionId, { ruleId, action: 'reject' });
      const committed = service.commitRules(sessionId);

      expect(committed.committedRuleIds).toHaveLength(0);
      expect(committed.policiesYaml).toBe('');
      expect(committed.warnings).toContain('No accepted rules to commit.');
    });

    it('throws for invalid session ID', () => {
      expect(() => service.commitRules('nonexistent')).toThrow('Session not found');
    });
  });

  // =========================================================================
  // Document Ingestion
  // =========================================================================

  describe('authorFromDocument', () => {
    it('extracts clauses from a policy document', () => {
      const doc = `# Security Policy

## Access Control

- Nobody shall access production databases without authorization
- All deployments must be approved by a team lead
- Financial transactions over $5000 require dual authorization

## Data Handling

- PII data must never be exposed in logs
- Only the security team can access audit records
`;

      const result = service.authorFromDocument({ documentContent: doc });

      expect(result.candidateRules.length).toBeGreaterThanOrEqual(3);
      // All should be draft or needs_human
      for (const rule of result.candidateRules) {
        expect(['draft', 'needs_human_policy_authoring']).toContain(rule.status);
        expect(rule.yamlContent).toContain('enabled: false');
      }
    });

    it('returns empty for non-policy documents', () => {
      const doc = `# Recipe

Ingredients:
- 2 cups flour
- 1 cup sugar
- Mix well and bake at 350F for 30 minutes
`;

      const result = service.authorFromDocument({ documentContent: doc });
      expect(result.candidateRules).toHaveLength(0);
      expect(result.warnings).toContain('No actionable policy clauses found in document.');
    });

    it('handles empty document gracefully', () => {
      const result = service.authorFromDocument({ documentContent: '   ' });
      expect(result.candidateRules).toHaveLength(0);
    });
  });

  // =========================================================================
  // Conflict Detection
  // =========================================================================

  describe('conflict detection', () => {
    it('warns when candidate conflicts with existing rule', () => {
      const result = service.authorFromText({
        naturalLanguage: 'nobody should drop the database',
        context: {
          existingRules: ['Allow database reads for analytics'],
        },
      });

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('conflict');
    });

    it('no warning when no overlap', () => {
      const result = service.authorFromText({
        naturalLanguage: 'nobody should drop the database',
        context: {
          existingRules: ['Email rate limit'],
        },
      });

      expect(result.warnings).toHaveLength(0);
    });
  });

  // =========================================================================
  // Multiple statements
  // =========================================================================

  // =========================================================================
  // Session ID in result (MCP end-to-end)
  // =========================================================================

  describe('sessionId in result', () => {
    it('authorFromText returns a sessionId that works with reviewRule and commitRules', () => {
      const result = service.authorFromText({
        naturalLanguage: 'nobody should drop the database',
      });

      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe('string');

      const ruleId = result.candidateRules[0].id;

      // Use the sessionId to review
      const reviewed = service.reviewRule(result.sessionId, { ruleId, action: 'accept' });
      expect(reviewed.status).toBe('accepted');

      // Use the sessionId to commit
      const committed = service.commitRules(result.sessionId);
      expect(committed.committedRuleIds).toContain(ruleId);
      expect(committed.policiesYaml).toContain('enabled: false');
    });

    it('authorFromDocument returns a sessionId', () => {
      const result = service.authorFromDocument({
        documentContent: '- Nobody shall access production databases without authorization',
      });

      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe('string');
      expect(result.candidateRules.length).toBeGreaterThan(0);

      // Verify sessionId works for review
      const ruleId = result.candidateRules[0].id;
      const reviewed = service.reviewRule(result.sessionId, { ruleId, action: 'accept' });
      expect(reviewed.status).toBe('accepted');
    });

    it('empty document still returns a valid sessionId', () => {
      const result = service.authorFromDocument({ documentContent: 'No policy content here' });

      expect(result.sessionId).toBeDefined();
      expect(result.candidateRules).toHaveLength(0);
    });
  });

  // =========================================================================
  // Multiple statements
  // =========================================================================

  describe('multiple statements', () => {
    it('splits input on sentence boundaries', () => {
      const result = service.authorFromText({
        naturalLanguage: 'Nobody should drop the database. Deployments need approval. Only admins can access reports.',
      });

      expect(result.candidateRules.length).toBe(3);
    });

    it('splits input on newlines', () => {
      const result = service.authorFromText({
        naturalLanguage: 'Nobody should drop the database\nDeployments need approval\nOnly admins can access reports',
      });

      expect(result.candidateRules.length).toBe(3);
    });
  });
});

