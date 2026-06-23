import type { LintRule, LintContext, LintDiagnostic } from '../lint-types.js';
import type { RuleExpression } from '../../compiler/policy-rule-expression.types.js';

function extractFields(expr: RuleExpression): string[] {
  switch (expr.type) {
    case 'field_presence':
      return expr.fields;
    case 'composite_and':
    case 'composite_or':
      return expr.rules.flatMap(extractFields);
    default:
      return 'field' in expr ? [(expr as { field: string }).field] : [];
  }
}

export const unknownInputField: LintRule = {
  id: 'unknown-input-field',
  severity: 'warning',
  check(context: LintContext): LintDiagnostic[] {
    if (!context.surfaceRegistry) return [];
    const diagnostics: LintDiagnostic[] = [];
    const defaultSurface = context.frontmatter?.surfaces?.[0];

    for (const clause of context.clauses) {
      if (!clause.condition) continue;
      const surfaceId = clause.surface_id ?? defaultSurface;
      if (!surfaceId) continue;

      const fields = extractFields(clause.condition);
      for (const field of fields) {
        if (!context.surfaceRegistry.isValidField(surfaceId, field)) {
          diagnostics.push({
            ruleId: this.id,
            severity: this.severity,
            message: `Field '${field}' is not defined in surface '${surfaceId}'`,
            clauseId: clause.clause_id,
            field,
            suggestion: `Add '${field}' to the inputFields of surface '${surfaceId}'`,
          });
        }
      }
    }
    return diagnostics;
  },
};
