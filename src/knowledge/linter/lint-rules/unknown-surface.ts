import type { LintRule, LintContext, LintDiagnostic } from '../lint-types.js';

export const unknownSurface: LintRule = {
  id: 'unknown-surface',
  severity: 'error',
  check(context: LintContext): LintDiagnostic[] {
    if (!context.surfaceRegistry) return [];
    const diagnostics: LintDiagnostic[] = [];
    const defaultSurface = context.frontmatter?.surfaces?.[0];

    for (const clause of context.clauses) {
      const surfaceId = clause.surface_id ?? defaultSurface;
      if (surfaceId && !context.surfaceRegistry.has(surfaceId)) {
        diagnostics.push({
          ruleId: this.id,
          severity: this.severity,
          message: `Surface '${surfaceId}' is not registered`,
          clauseId: clause.clause_id,
          field: 'surface_id',
          suggestion: `Register '${surfaceId}' in the surface contract registry`,
        });
      }
    }
    return diagnostics;
  },
};
