import type { LintRule, LintContext, LintDiagnostic } from '../lint-types.js';

export const unknownDecisionLabel: LintRule = {
  id: 'unknown-decision-label',
  severity: 'error',
  check(context: LintContext): LintDiagnostic[] {
    if (!context.surfaceRegistry) return [];
    const diagnostics: LintDiagnostic[] = [];
    const defaultSurface = context.frontmatter?.surfaces?.[0];

    for (const clause of context.clauses) {
      if (!clause.decision) continue;
      const surfaceId = clause.surface_id ?? defaultSurface;
      if (!surfaceId) continue;

      if (!context.surfaceRegistry.isValidDecision(surfaceId, clause.decision)) {
        diagnostics.push({
          ruleId: this.id,
          severity: this.severity,
          message: `Decision '${clause.decision}' is not valid for surface '${surfaceId}'`,
          clauseId: clause.clause_id,
          field: 'decision',
          suggestion: `Use one of the valid decisions for surface '${surfaceId}'`,
        });
      }
    }
    return diagnostics;
  },
};
