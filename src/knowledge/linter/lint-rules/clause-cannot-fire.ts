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

export const clauseCannotFire: LintRule = {
  id: 'clause-cannot-fire',
  severity: 'warning',
  check(context: LintContext): LintDiagnostic[] {
    if (!context.surfaceRegistry) return [];
    const diagnostics: LintDiagnostic[] = [];

    for (const clause of context.clauses) {
      if (!clause.condition) continue;
      const surfaceId = clause.surface_id ?? context.frontmatter?.surfaces?.[0];
      if (!surfaceId || !context.surfaceRegistry.has(surfaceId)) continue;

      const fields = extractFields(clause.condition);
      const contract = context.surfaceRegistry.get(surfaceId);
      if (!contract || contract.inputFields.length === 0) continue;

      const knownFields = new Set(contract.inputFields.map((f) => f.name));
      const unknownFields = fields.filter((f) => !knownFields.has(f));

      if (unknownFields.length === fields.length && fields.length > 0) {
        diagnostics.push({
          ruleId: this.id,
          severity: this.severity,
          message: `Clause '${clause.clause_id}' references fields [${unknownFields.join(', ')}] — none are defined on surface '${surfaceId}'`,
          clauseId: clause.clause_id,
          suggestion: 'This rule may never fire. Check that field names match the surface contract',
        });
      }
    }
    return diagnostics;
  },
};
