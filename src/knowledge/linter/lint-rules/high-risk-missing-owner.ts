import type { LintRule, LintContext, LintDiagnostic } from '../lint-types.js';

export const highRiskMissingOwner: LintRule = {
  id: 'high-risk-missing-owner',
  severity: 'warning',
  check(context: LintContext): LintDiagnostic[] {
    if (!context.surfaceRegistry) return [];
    const diagnostics: LintDiagnostic[] = [];
    const defaultSurface = context.frontmatter?.surfaces?.[0];
    const defaultOwner = context.frontmatter?.owner;

    for (const clause of context.clauses) {
      const surfaceId = clause.surface_id ?? defaultSurface;
      if (!surfaceId) continue;

      const contract = context.surfaceRegistry.get(surfaceId);
      if (contract?.riskTier === 'critical' && !clause.owner && !defaultOwner) {
        diagnostics.push({
          ruleId: this.id,
          severity: this.severity,
          message: `Critical-risk surface '${surfaceId}' clause '${clause.clause_id}' has no owner`,
          clauseId: clause.clause_id,
          suggestion: 'Add an owner to the clause or to the frontmatter',
        });
      }
    }
    return diagnostics;
  },
};
