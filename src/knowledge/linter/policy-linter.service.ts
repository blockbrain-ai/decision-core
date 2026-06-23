import type { LintRule, LintContext, LintReport } from './lint-types.js';
import { missingSurfaceId } from './lint-rules/missing-surface-id.js';
import { unknownSurface } from './lint-rules/unknown-surface.js';
import { unknownInputField } from './lint-rules/unknown-input-field.js';
import { unknownDecisionLabel } from './lint-rules/unknown-decision-label.js';
import { missingSafeFallback } from './lint-rules/missing-safe-fallback.js';
import { forbiddenSafeOverlap } from './lint-rules/forbidden-safe-overlap.js';
import { vagueObligation } from './lint-rules/vague-obligation.js';
import { protectedAttributeMissing } from './lint-rules/protected-attribute-missing.js';
import { safeExecuteNondeterministic } from './lint-rules/safe-execute-nondeterministic.js';
import { highRiskMissingOwner } from './lint-rules/high-risk-missing-owner.js';
import { proseOnlyPolicy } from './lint-rules/prose-only-policy.js';
import { clauseCannotFire } from './lint-rules/clause-cannot-fire.js';

const BUILT_IN_RULES: LintRule[] = [
  missingSurfaceId,
  unknownSurface,
  unknownInputField,
  unknownDecisionLabel,
  missingSafeFallback,
  forbiddenSafeOverlap,
  vagueObligation,
  protectedAttributeMissing,
  safeExecuteNondeterministic,
  highRiskMissingOwner,
  proseOnlyPolicy,
  clauseCannotFire,
];

export interface PolicyLinter {
  lint(context: LintContext): LintReport;
  registerRule(rule: LintRule): void;
}

export interface PolicyLinterOptions {
  customRules?: LintRule[];
  strictStructured?: boolean;
}

export function createPolicyLinter(options?: PolicyLinterOptions): PolicyLinter {
  const rules: LintRule[] = [...BUILT_IN_RULES, ...(options?.customRules ?? [])];

  return {
    lint(context: LintContext): LintReport {
      const effectiveContext: LintContext = {
        ...context,
        strictStructured: context.strictStructured ?? options?.strictStructured ?? false,
      };
      const diagnostics = rules.flatMap((rule) => rule.check(effectiveContext)).map((diagnostic) => {
        if (!diagnostic.clauseId || diagnostic.line !== undefined) return diagnostic;
        const sourceLineRef = effectiveContext.sourceLineRefs?.[diagnostic.clauseId];
        if (!sourceLineRef) return diagnostic;
        return { ...diagnostic, line: sourceLineRef.startLine };
      });

      return {
        documentId: context.frontmatter?.policy_id ?? context.documentSource ?? '<unknown>',
        diagnostics,
        errorCount: diagnostics.filter((d) => d.severity === 'error').length,
        warningCount: diagnostics.filter((d) => d.severity === 'warning').length,
        infoCount: diagnostics.filter((d) => d.severity === 'info').length,
        lintedAt: new Date().toISOString(),
      };
    },

    registerRule(rule: LintRule): void {
      rules.push(rule);
    },
  };
}
