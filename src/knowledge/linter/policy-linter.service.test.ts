import { describe, it, expect } from 'vitest';
import { createPolicyLinter } from './policy-linter.service.js';
import { LintDiagnosticSchema, LintReportSchema } from './lint-types.js';
import type { LintContext, LintRule } from './lint-types.js';
import type { StructuredClauseBlock } from '../authoring/structured-clause.types.js';
import { SurfaceContractRegistry } from '../surfaces/surface-contract-registry.service.js';
import type { SurfaceContract } from '../surfaces/surface-contract.types.js';

const FINANCE_SURFACE: SurfaceContract = {
  surfaceId: 'finance.processing',
  displayName: 'Finance Processing',
  category: 'finance',
  validDecisions: ['allow', 'deny', 'approve_required', 'escalate'],
  inputFields: [
    { name: 'amount', type: 'number', required: true, protectedAttribute: false },
    { name: 'currency', type: 'string', required: true, protectedAttribute: false },
  ],
  forbiddenOutputs: ['auto_approve_high_risk'],
  safeFallback: 'deny',
  maxAutonomyTier: 2,
  protectedAttributeHazard: true,
  riskTier: 'critical',
};

function makeRegistry(): SurfaceContractRegistry {
  const r = new SurfaceContractRegistry();
  r.register(FINANCE_SURFACE);
  return r;
}

function makeContext(overrides: Partial<LintContext> = {}): LintContext {
  return {
    clauses: [],
    hasStructuredClauses: true,
    ...overrides,
  };
}

function makeClause(overrides: Partial<StructuredClauseBlock> = {}): StructuredClauseBlock {
  return {
    clause_id: 'test.001',
    clause_type: 'threshold',
    ...overrides,
  };
}

describe('PolicyLinter', () => {
  const linter = createPolicyLinter();

  describe('missing-surface-id', () => {
    it('reports clause with no surface_id and no frontmatter default', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause()],
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'missing-surface-id');
      expect(diag).toBeDefined();
      expect(diag!.severity).toBe('error');
    });

    it('does not report when frontmatter provides default surface', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause()],
        frontmatter: { schema_version: '1.0.0', policy_id: 'x', surfaces: ['finance.processing'] },
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'missing-surface-id');
      expect(diag).toBeUndefined();
    });
  });

  describe('unknown-surface', () => {
    it('reports surface not in registry', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({ surface_id: 'nonexistent.surface' })],
        surfaceRegistry: makeRegistry(),
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'unknown-surface');
      expect(diag).toBeDefined();
    });

    it('does not report known surface', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({ surface_id: 'finance.processing' })],
        surfaceRegistry: makeRegistry(),
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'unknown-surface');
      expect(diag).toBeUndefined();
    });

    it('skips when no registry provided', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({ surface_id: 'nonexistent' })],
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'unknown-surface');
      expect(diag).toBeUndefined();
    });
  });

  describe('unknown-input-field', () => {
    it('warns on field not in surface contract', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({
          surface_id: 'finance.processing',
          condition: { type: 'threshold', field: 'nonexistent_field', operator: 'gte', value: 100 },
        })],
        surfaceRegistry: makeRegistry(),
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'unknown-input-field');
      expect(diag).toBeDefined();
      expect(diag!.field).toBe('nonexistent_field');
    });

    it('does not warn on known field', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({
          surface_id: 'finance.processing',
          condition: { type: 'threshold', field: 'amount', operator: 'gte', value: 100 },
        })],
        surfaceRegistry: makeRegistry(),
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'unknown-input-field');
      expect(diag).toBeUndefined();
    });

    it('checks fields in composite expressions', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({
          surface_id: 'finance.processing',
          condition: {
            type: 'composite_and',
            rules: [
              { type: 'threshold', field: 'amount', operator: 'gte', value: 100 },
              { type: 'threshold', field: 'bad_field', operator: 'lt', value: 50 },
            ],
          },
        })],
        surfaceRegistry: makeRegistry(),
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'unknown-input-field');
      expect(diag).toBeDefined();
      expect(diag!.field).toBe('bad_field');
    });
  });

  describe('unknown-decision-label', () => {
    it('reports decision not in surface validDecisions', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({ surface_id: 'finance.processing', decision: 'auto_approve' })],
        surfaceRegistry: makeRegistry(),
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'unknown-decision-label');
      expect(diag).toBeDefined();
    });

    it('accepts valid decision', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({ surface_id: 'finance.processing', decision: 'deny' })],
        surfaceRegistry: makeRegistry(),
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'unknown-decision-label');
      expect(diag).toBeUndefined();
    });
  });

  describe('forbidden-safe-overlap', () => {
    it('reports decision that is a forbidden output', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({ surface_id: 'finance.processing', decision: 'auto_approve_high_risk' })],
        surfaceRegistry: makeRegistry(),
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'forbidden-safe-overlap');
      expect(diag).toBeDefined();
    });
  });

  describe('vague-obligation', () => {
    it('warns on obligation without condition', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({ clause_type: 'obligation' })],
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'vague-obligation');
      expect(diag).toBeDefined();
    });

    it('does not warn on obligation with condition', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({
          clause_type: 'obligation',
          condition: { type: 'boolean_required', field: 'x', requiredValue: true },
        })],
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'vague-obligation');
      expect(diag).toBeUndefined();
    });
  });

  describe('protected-attribute-missing', () => {
    it('warns when surface has hazard but clause lacks review flag', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({ surface_id: 'finance.processing' })],
        surfaceRegistry: makeRegistry(),
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'protected-attribute-missing');
      expect(diag).toBeDefined();
    });

    it('does not warn when protected_attribute_review is true', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({ surface_id: 'finance.processing', protected_attribute_review: true })],
        surfaceRegistry: makeRegistry(),
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'protected-attribute-missing');
      expect(diag).toBeUndefined();
    });
  });

  describe('safe-execute-nondeterministic', () => {
    it('reports safe_to_execute_without_model on frontier route class', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({
          safe_to_execute_without_model: true,
          route_class: 'frontier_or_human_required',
        })],
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'safe-execute-nondeterministic');
      expect(diag).toBeDefined();
    });

    it('reports safe_to_execute_without_model on deterministic guardrail then A5 route class', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({
          safe_to_execute_without_model: true,
          route_class: 'deterministic_guardrail_then_a5',
        })],
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'safe-execute-nondeterministic');
      expect(diag).toBeDefined();
    });

    it('allows safe_to_execute_without_model on deterministic route class', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({
          safe_to_execute_without_model: true,
          route_class: 'deterministic_only',
        })],
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'safe-execute-nondeterministic');
      expect(diag).toBeUndefined();
    });
  });

  describe('high-risk-missing-owner', () => {
    it('warns on critical surface clause without owner', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({ surface_id: 'finance.processing' })],
        surfaceRegistry: makeRegistry(),
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'high-risk-missing-owner');
      expect(diag).toBeDefined();
    });

    it('does not warn when clause has owner', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({ surface_id: 'finance.processing', owner: 'alice@example.com' })],
        surfaceRegistry: makeRegistry(),
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'high-risk-missing-owner');
      expect(diag).toBeUndefined();
    });

    it('does not warn when frontmatter has owner', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({ surface_id: 'finance.processing' })],
        surfaceRegistry: makeRegistry(),
        frontmatter: { schema_version: '1.0.0', policy_id: 'x', owner: 'bob@example.com' },
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'high-risk-missing-owner');
      expect(diag).toBeUndefined();
    });
  });

  describe('prose-only-policy', () => {
    it('reports info when no structured clauses', () => {
      const report = linter.lint(makeContext({ hasStructuredClauses: false }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'prose-only-policy');
      expect(diag).toBeDefined();
      expect(diag!.severity).toBe('info');
    });

    it('reports error in strict structured mode', () => {
      const strictLinter = createPolicyLinter({ strictStructured: true });
      const report = strictLinter.lint(makeContext({ hasStructuredClauses: false }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'prose-only-policy');
      expect(diag).toBeDefined();
      expect(diag!.severity).toBe('error');
    });

    it('silent when structured clauses exist', () => {
      const report = linter.lint(makeContext({ hasStructuredClauses: true }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'prose-only-policy');
      expect(diag).toBeUndefined();
    });
  });

  describe('clause-cannot-fire', () => {
    it('warns when all referenced fields are unknown to the surface', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({
          surface_id: 'finance.processing',
          condition: { type: 'threshold', field: 'completely_unknown', operator: 'gte', value: 1 },
        })],
        surfaceRegistry: makeRegistry(),
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'clause-cannot-fire');
      expect(diag).toBeDefined();
    });

    it('does not warn when some fields are known', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause({
          surface_id: 'finance.processing',
          condition: {
            type: 'composite_and',
            rules: [
              { type: 'threshold', field: 'amount', operator: 'gte', value: 100 },
              { type: 'threshold', field: 'unknown', operator: 'lt', value: 50 },
            ],
          },
        })],
        surfaceRegistry: makeRegistry(),
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'clause-cannot-fire');
      expect(diag).toBeUndefined();
    });
  });

  describe('report structure', () => {
    it('counts severities correctly', () => {
      const report = linter.lint(makeContext({
        clauses: [
          makeClause({ surface_id: 'nonexistent', decision: 'bad' }),
        ],
        surfaceRegistry: makeRegistry(),
        hasStructuredClauses: false,
      }));
      expect(report.errorCount).toBeGreaterThan(0);
      expect(report.lintedAt).toBeDefined();
      expect(report.documentId).toBe('<unknown>');
    });

    it('uses frontmatter policy_id as documentId', () => {
      const report = linter.lint(makeContext({
        frontmatter: { schema_version: '1.0.0', policy_id: 'dc.finance.001' },
      }));
      expect(report.documentId).toBe('dc.finance.001');
    });

    it('fills diagnostic line numbers from sourceLineRefs', () => {
      const report = linter.lint(makeContext({
        clauses: [makeClause()],
        sourceLineRefs: {
          'test.001': { file: 'policy.md', startLine: 42, endLine: 50 },
        },
      }));
      const diag = report.diagnostics.find((d) => d.ruleId === 'missing-surface-id');
      expect(diag?.line).toBe(42);
    });

    it('exports Zod schemas for diagnostics and reports', () => {
      const diagnostic = LintDiagnosticSchema.parse({
        ruleId: 'x',
        severity: 'warning',
        message: 'msg',
        line: 1,
      });
      expect(diagnostic.ruleId).toBe('x');

      const report = linter.lint(makeContext());
      expect(() => LintReportSchema.parse(report)).not.toThrow();
    });
  });

  describe('custom rules', () => {
    it('includes custom rules in lint', () => {
      const custom: LintRule = {
        id: 'custom-rule',
        severity: 'info',
        check: () => [{ ruleId: 'custom-rule', severity: 'info', message: 'Custom check' }],
      };
      const customLinter = createPolicyLinter({ customRules: [custom] });
      const report = customLinter.lint(makeContext());
      expect(report.diagnostics.some((d) => d.ruleId === 'custom-rule')).toBe(true);
    });

    it('supports registerRule after creation', () => {
      const l = createPolicyLinter();
      l.registerRule({
        id: 'dynamic-rule',
        severity: 'warning',
        check: () => [{ ruleId: 'dynamic-rule', severity: 'warning', message: 'Dynamic' }],
      });
      const report = l.lint(makeContext());
      expect(report.diagnostics.some((d) => d.ruleId === 'dynamic-rule')).toBe(true);
    });
  });
});
