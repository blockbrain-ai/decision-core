import { z } from 'zod';
import type { StructuredClauseBlock, PolicyFrontmatter, SourceLineRef } from '../authoring/structured-clause.types.js';
import type { CompilationResult } from '../compiler/policy-rule-expression.types.js';
import type { SurfaceContractRegistry } from '../surfaces/surface-contract-registry.service.js';

// ===========================================================================
// Severity and Diagnostic
// ===========================================================================

export const LintSeveritySchema = z.enum(['error', 'warning', 'info']);
export type LintSeverity = z.infer<typeof LintSeveritySchema>;

export interface LintDiagnostic {
  ruleId: string;
  severity: LintSeverity;
  message: string;
  clauseId?: string;
  field?: string;
  line?: number;
  suggestion?: string;
}

export const LintDiagnosticSchema = z.object({
  ruleId: z.string(),
  severity: LintSeveritySchema,
  message: z.string(),
  clauseId: z.string().optional(),
  field: z.string().optional(),
  line: z.number().int().positive().optional(),
  suggestion: z.string().optional(),
});

// ===========================================================================
// Lint Report
// ===========================================================================

export interface LintReport {
  documentId: string;
  diagnostics: LintDiagnostic[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  lintedAt: string;
}

export const LintReportSchema = z.object({
  documentId: z.string(),
  diagnostics: z.array(LintDiagnosticSchema),
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  infoCount: z.number().int().nonnegative(),
  lintedAt: z.string(),
});

// ===========================================================================
// Lint Rule Interface
// ===========================================================================

export interface LintContext {
  clauses: StructuredClauseBlock[];
  compilationResult?: CompilationResult;
  surfaceRegistry?: SurfaceContractRegistry;
  frontmatter?: PolicyFrontmatter;
  documentSource?: string;
  sourceLineRefs?: Record<string, SourceLineRef>;
  hasStructuredClauses?: boolean;
  strictStructured?: boolean;
}

export interface LintRule {
  id: string;
  severity: LintSeverity;
  check(context: LintContext): LintDiagnostic[];
}
