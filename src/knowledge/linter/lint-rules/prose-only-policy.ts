import type { LintRule, LintContext, LintDiagnostic } from '../lint-types.js';

export const proseOnlyPolicy: LintRule = {
  id: 'prose-only-policy',
  severity: 'info',
  check(context: LintContext): LintDiagnostic[] {
    if (context.hasStructuredClauses) return [];
    const severity = context.strictStructured ? 'error' : this.severity;

    return [{
      ruleId: this.id,
      severity,
      message: 'Document has no structured clauses — clauses will be extracted via regex with reduced confidence',
      suggestion: 'Add decision-core-clause fenced blocks for deterministic compilation',
    }];
  },
};
