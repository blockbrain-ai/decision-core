/**
 * Policy Rule Expression Types
 *
 * Discriminated union of 16 rule expression types that cover
 * real enterprise policy patterns. Each type specifies parameters
 * and evaluation semantics for deterministic enforcement.
 */

import { z } from 'zod';
import type { SourceLineRef } from '../authoring/structured-clause.types.js';

// ===========================================================================
// Rule Type Enum
// ===========================================================================

export const RULE_TYPES = [
  'threshold',
  'range',
  'enum_match',
  'string_match',
  'boolean_required',
  'field_presence',
  'sanctions_match',
  'regex_match',
  'date_range',
  'amount_limit',
  'count_limit',
  'role_required',
  'jurisdiction_match',
  'list_membership',
  'composite_and',
  'composite_or',
] as const;

export const RuleTypeSchema = z.enum(RULE_TYPES);
export type RuleType = z.infer<typeof RuleTypeSchema>;

// ===========================================================================
// Individual Rule Expression Schemas
// ===========================================================================

export const ThresholdExpressionSchema = z.object({
  type: z.literal('threshold'),
  field: z.string(),
  operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']),
  value: z.number(),
});
export type ThresholdExpression = z.infer<typeof ThresholdExpressionSchema>;

export const RangeExpressionSchema = z.object({
  type: z.literal('range'),
  field: z.string(),
  min: z.number(),
  max: z.number(),
  inclusive: z.boolean(),
});
export type RangeExpression = z.infer<typeof RangeExpressionSchema>;

export const EnumMatchExpressionSchema = z.object({
  type: z.literal('enum_match'),
  field: z.string(),
  allowedValues: z.array(z.string()),
});
export type EnumMatchExpression = z.infer<typeof EnumMatchExpressionSchema>;

export const StringMatchExpressionSchema = z.object({
  type: z.literal('string_match'),
  field: z.string(),
  pattern: z.string(),
  caseSensitive: z.boolean(),
});
export type StringMatchExpression = z.infer<typeof StringMatchExpressionSchema>;

export const BooleanRequiredExpressionSchema = z.object({
  type: z.literal('boolean_required'),
  field: z.string(),
  requiredValue: z.boolean(),
});
export type BooleanRequiredExpression = z.infer<typeof BooleanRequiredExpressionSchema>;

export const FieldPresenceExpressionSchema = z.object({
  type: z.literal('field_presence'),
  fields: z.array(z.string()),
  allRequired: z.boolean(),
});
export type FieldPresenceExpression = z.infer<typeof FieldPresenceExpressionSchema>;

export const SanctionsMatchExpressionSchema = z.object({
  type: z.literal('sanctions_match'),
  field: z.string(),
  sanctionsLists: z.array(z.string()),
});
export type SanctionsMatchExpression = z.infer<typeof SanctionsMatchExpressionSchema>;

export const RegexMatchExpressionSchema = z.object({
  type: z.literal('regex_match'),
  field: z.string(),
  pattern: z.string(),
  flags: z.string().optional(),
});
export type RegexMatchExpression = z.infer<typeof RegexMatchExpressionSchema>;

export const DateRangeExpressionSchema = z.object({
  type: z.literal('date_range'),
  field: z.string(),
  after: z.string().nullable(),
  before: z.string().nullable(),
});
export type DateRangeExpression = z.infer<typeof DateRangeExpressionSchema>;

export const AmountLimitExpressionSchema = z.object({
  type: z.literal('amount_limit'),
  field: z.string(),
  maxAmount: z.number(),
  currency: z.string().optional(),
});
export type AmountLimitExpression = z.infer<typeof AmountLimitExpressionSchema>;

export const CountLimitExpressionSchema = z.object({
  type: z.literal('count_limit'),
  field: z.string(),
  maxCount: z.number(),
  timeWindowMinutes: z.number().optional(),
});
export type CountLimitExpression = z.infer<typeof CountLimitExpressionSchema>;

export const RoleRequiredExpressionSchema = z.object({
  type: z.literal('role_required'),
  field: z.string(),
  requiredRoles: z.array(z.string()),
  anyOf: z.boolean(),
});
export type RoleRequiredExpression = z.infer<typeof RoleRequiredExpressionSchema>;

export const JurisdictionMatchExpressionSchema = z.object({
  type: z.literal('jurisdiction_match'),
  field: z.string(),
  allowedJurisdictions: z.array(z.string()),
});
export type JurisdictionMatchExpression = z.infer<typeof JurisdictionMatchExpressionSchema>;

export const ListMembershipExpressionSchema = z.object({
  type: z.literal('list_membership'),
  field: z.string(),
  listId: z.string(),
  mustBePresent: z.boolean(),
});
export type ListMembershipExpression = z.infer<typeof ListMembershipExpressionSchema>;

export interface CompositeAndExpression {
  type: 'composite_and';
  rules: RuleExpression[];
}

export interface CompositeOrExpression {
  type: 'composite_or';
  rules: RuleExpression[];
}

// ===========================================================================
// Discriminated Union
// ===========================================================================

export type RuleExpression =
  | ThresholdExpression
  | RangeExpression
  | EnumMatchExpression
  | StringMatchExpression
  | BooleanRequiredExpression
  | FieldPresenceExpression
  | SanctionsMatchExpression
  | RegexMatchExpression
  | DateRangeExpression
  | AmountLimitExpression
  | CountLimitExpression
  | RoleRequiredExpression
  | JurisdictionMatchExpression
  | ListMembershipExpression
  | CompositeAndExpression
  | CompositeOrExpression;

export const CompositeAndExpressionSchema: z.ZodType<CompositeAndExpression> = z.object({
  type: z.literal('composite_and'),
  rules: z.array(z.lazy(() => RuleExpressionSchema)),
});

export const CompositeOrExpressionSchema: z.ZodType<CompositeOrExpression> = z.object({
  type: z.literal('composite_or'),
  rules: z.array(z.lazy(() => RuleExpressionSchema)),
});

export const RuleExpressionSchema: z.ZodType<RuleExpression> = z.union([
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
]);

// ===========================================================================
// Compiled Rule
// ===========================================================================

export const CompiledRuleSchema = z.object({
  id: z.string(),
  clauseId: z.string(),
  controlId: z.string().nullable(),
  ruleType: RuleTypeSchema,
  expression: z.record(z.unknown()),
  description: z.string(),
  compiledAt: z.string(),
  sourceLineRef: z.object({
    file: z.string(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  }).optional(),
  surfaceId: z.string().optional(),
  authoringSchemaVersion: z.string().optional(),
  decision: z.string().optional(),
});
export type CompiledRule = {
  id: string;
  clauseId: string;
  controlId: string | null;
  ruleType: RuleType;
  expression: RuleExpression;
  description: string;
  compiledAt: string;
  sourceLineRef?: SourceLineRef;
  surfaceId?: string;
  authoringSchemaVersion?: string;
  decision?: string;
};

// ===========================================================================
// Compilation Result
// ===========================================================================

export interface AmbiguousClause {
  clauseId: string;
  reason: string;
  status: 'needs_human_policy_authoring';
}

export interface CompilationError {
  clauseId: string;
  error: string;
}

export interface CompilationResult {
  compiledRules: CompiledRule[];
  ambiguousClauses: AmbiguousClause[];
  errors: CompilationError[];
  diagnostics?: import('./compiler-diagnostics.js').CompilerDiagnostic[];
}

// ===========================================================================
// Rule Evaluation
// ===========================================================================

export interface DecisionContext {
  [key: string]: unknown;
}

export interface RuleEvalResult {
  passed: boolean;
  ruleId: string;
  clauseId: string;
  controlId: string | null;
  inputFields: Record<string, unknown>;
  result: 'pass' | 'fail' | 'error';
  errorMessage?: string;
  diagnostic?: import('./compiler-diagnostics.js').EvalDiagnostic;
  conditionHash?: string;
}
