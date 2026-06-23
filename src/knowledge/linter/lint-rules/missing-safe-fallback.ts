import type { LintRule, LintContext, LintDiagnostic } from '../lint-types.js';

export const missingSafeFallback: LintRule = {
  id: 'missing-safe-fallback',
  severity: 'warning',
  check(context: LintContext): LintDiagnostic[] {
    if (!context.surfaceRegistry) return [];
    const diagnostics: LintDiagnostic[] = [];
    const seen = new Set<string>();
    const defaultSurface = context.frontmatter?.surfaces?.[0];

    for (const clause of context.clauses) {
      const surfaceId = clause.surface_id ?? defaultSurface;
      if (!surfaceId || seen.has(surfaceId)) continue;
      seen.add(surfaceId);

      const contract = context.surfaceRegistry.get(surfaceId);
      if (contract && !contract.safeFallback) {
        diagnostics.push({
          ruleId: this.id,
          severity: this.severity,
          message: `Surface '${surfaceId}' has no safeFallback configured`,
          suggestion: 'Set safeFallback in the surface contract (typically "deny" or "escalate")',
        });
      }
    }
    return diagnostics;
  },
};
