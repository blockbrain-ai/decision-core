export { createCompiledRuleEvaluator } from './compiled-rule-evaluator.js';
export type { CompiledRuleEvaluator } from './compiled-rule-evaluator.js';

export { createPolicyRuleCompiler } from './policy-rule-compiler.service.js';
export type {
  PolicyRuleCompiler,
  ControlProvider,
  StructuredCompilerInputProvider,
  PolicyRuleCompilerOptions,
} from './policy-rule-compiler.service.js';

export { createVersionedRuleSetRepository, computeRuleSetHash } from './compiled-rule-set.repository.js';
export type { VersionedRuleSetRepository } from './compiled-rule-set.repository.js';

export { createPolicyRuleTestHarness } from './policy-rule-test-harness.js';
export type { PolicyRuleTestHarness, TestCase, TestCaseResult, HarnessReport } from './policy-rule-test-harness.js';

export { CompilerDiagnosticStageSchema, CompilerDiagnosticOutcomeSchema } from './compiler-diagnostics.js';
export type { CompilerDiagnosticStage, CompilerDiagnosticOutcome, CompilerDiagnostic, EvalDiagnostic } from './compiler-diagnostics.js';

export { generateScenarios } from './scenario-generator.js';
export type { ScenarioGeneratorOptions } from './scenario-generator.js';

export {
  RULE_TYPES,
  RuleTypeSchema,
  ThresholdExpressionSchema,
  RangeExpressionSchema,
  EnumMatchExpressionSchema,
  StringMatchExpressionSchema,
  BooleanRequiredExpressionSchema,
  FieldPresenceExpressionSchema,
  SanctionsMatchExpressionSchema,
  RegexMatchExpressionSchema,
  DateRangeExpressionSchema,
  AmountLimitExpressionSchema,
  CountLimitExpressionSchema,
  RoleRequiredExpressionSchema,
  JurisdictionMatchExpressionSchema,
  ListMembershipExpressionSchema,
  CompositeAndExpressionSchema,
  CompositeOrExpressionSchema,
  RuleExpressionSchema,
  CompiledRuleSchema,
} from './policy-rule-expression.types.js';
export type {
  RuleType,
  ThresholdExpression,
  RangeExpression,
  EnumMatchExpression,
  StringMatchExpression,
  BooleanRequiredExpression,
  FieldPresenceExpression,
  SanctionsMatchExpression,
  RegexMatchExpression,
  DateRangeExpression,
  AmountLimitExpression,
  CountLimitExpression,
  RoleRequiredExpression,
  JurisdictionMatchExpression,
  ListMembershipExpression,
  CompositeAndExpression,
  CompositeOrExpression,
  RuleExpression,
  CompiledRule,
  AmbiguousClause,
  CompilationError,
  CompilationResult,
  RuleEvalResult,
} from './policy-rule-expression.types.js';
