import type { LintRule, LintContext, LintDiagnostic } from '../lint-types.js';

const NONDETERMINISTIC_ROUTE_CLASSES = new Set([
  'deterministic_guardrail_then_a5',
  'a5_default_with_deterministic_validator',
  'a5_plus_frontier_shadow',
  'frontier_or_human_required',
  'not_ready_data_or_policy_gap',
]);

export const safeExecuteNondeterministic: LintRule = {
  id: 'safe-execute-nondeterministic',
  severity: 'error',
  check(context: LintContext): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    for (const clause of context.clauses) {
      if (
        clause.safe_to_execute_without_model === true &&
        clause.route_class &&
        NONDETERMINISTIC_ROUTE_CLASSES.has(clause.route_class)
      ) {
        diagnostics.push({
          ruleId: this.id,
          severity: this.severity,
          message: `Clause '${clause.clause_id}' has safe_to_execute_without_model=true but route_class '${clause.route_class}' requires model/frontier/human review`,
          clauseId: clause.clause_id,
          field: 'safe_to_execute_without_model',
          suggestion: `Set safe_to_execute_without_model to false, or change route_class to deterministic_only or deterministic_first_a5_on_uncertain`,
        });
      }
    }
    return diagnostics;
  },
};
