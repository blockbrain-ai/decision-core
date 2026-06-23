import type { LintRule, LintContext, LintDiagnostic } from '../lint-types.js';

export const protectedAttributeMissing: LintRule = {
  id: 'protected-attribute-missing',
  severity: 'warning',
  check(context: LintContext): LintDiagnostic[] {
    if (!context.surfaceRegistry) return [];
    const diagnostics: LintDiagnostic[] = [];
    const defaultSurface = context.frontmatter?.surfaces?.[0];

    for (const clause of context.clauses) {
      const surfaceId = clause.surface_id ?? defaultSurface;
      if (!surfaceId) continue;

      const contract = context.surfaceRegistry.get(surfaceId);
      if (contract?.protectedAttributeHazard && clause.protected_attribute_review !== true) {
        diagnostics.push({
          ruleId: this.id,
          severity: this.severity,
          message: `Surface '${surfaceId}' has protectedAttributeHazard but clause '${clause.clause_id}' lacks protected_attribute_review: true`,
          clauseId: clause.clause_id,
          suggestion: 'Add protected_attribute_review: true to acknowledge the hazard',
        });
      }
    }
    return diagnostics;
  },
};
