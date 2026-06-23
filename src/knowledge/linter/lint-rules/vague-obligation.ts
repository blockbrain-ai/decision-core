import type { LintRule, LintContext, LintDiagnostic } from '../lint-types.js';

export const vagueObligation: LintRule = {
  id: 'vague-obligation',
  severity: 'warning',
  check(context: LintContext): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    for (const clause of context.clauses) {
      if (clause.clause_type === 'obligation' && !clause.condition) {
        diagnostics.push({
          ruleId: this.id,
          severity: this.severity,
          message: `Obligation clause '${clause.clause_id}' has no structured condition`,
          clauseId: clause.clause_id,
          suggestion: 'Add a condition with a RuleExpression to make this clause deterministically enforceable',
        });
      }
    }
    return diagnostics;
  },
};
