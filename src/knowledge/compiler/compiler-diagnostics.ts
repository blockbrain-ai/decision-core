import { z } from 'zod';

// ===========================================================================
// Compiler Diagnostics
// ===========================================================================

export const CompilerDiagnosticStageSchema = z.enum([
  'clause_lookup',
  'status_check',
  'structured_condition',
  'control_mapping',
  'pattern_match',
  'expression_build',
  'surface_contract_validation',
]);
export type CompilerDiagnosticStage = z.infer<typeof CompilerDiagnosticStageSchema>;

export const CompilerDiagnosticOutcomeSchema = z.enum(['success', 'skipped', 'failed', 'ambiguous']);
export type CompilerDiagnosticOutcome = z.infer<typeof CompilerDiagnosticOutcomeSchema>;

export interface CompilerDiagnostic {
  clauseId: string;
  stage: CompilerDiagnosticStage;
  outcome: CompilerDiagnosticOutcome;
  message: string;
  controlsFound?: number;
  patternAttempted?: string;
  matchedField?: string;
}

// ===========================================================================
// Eval Diagnostics
// ===========================================================================

export interface EvalDiagnostic {
  ruleId: string;
  expressionType: string;
  fieldChecked?: string;
  valueFound?: unknown;
  valueExpected?: unknown;
  operator?: string;
  reason: string;
  subDiagnostics?: EvalDiagnostic[];
}
