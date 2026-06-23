import type { LintRule, LintContext, LintDiagnostic } from '../lint-types.js';

export const missingSurfaceId: LintRule = {
  id: 'missing-surface-id',
  severity: 'error',
  check(context: LintContext): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];
    const defaultSurface = context.frontmatter?.surfaces?.[0];

    for (const clause of context.clauses) {
      if (!clause.surface_id && !defaultSurface) {
        diagnostics.push({
          ruleId: this.id,
          severity: this.severity,
          message: `Clause '${clause.clause_id}' has no surface_id and no frontmatter default surface`,
          clauseId: clause.clause_id,
          suggestion: 'Add surface_id to the clause or surfaces to the frontmatter',
        });
      }
    }
    return diagnostics;
  },
};
