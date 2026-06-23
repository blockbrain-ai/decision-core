/**
 * Compliance Audit Contract Types
 *
 * Zod schemas for the compliance audit skill:
 * audit requests, reports, gaps, and evidence integrity results.
 */

import { z } from 'zod';

// ===========================================================================
// Gap Categories
// ===========================================================================

export const GAP_CATEGORIES = [
  'missing_policy',
  'missing_trust_tier',
  'evidence_integrity',
  'low_confidence',
  'unaudited_tool',
  'bypassed_governance',
] as const;
export const GapCategorySchema = z.enum(GAP_CATEGORIES);
export type GapCategory = z.infer<typeof GapCategorySchema>;

// ===========================================================================
// Gap Severity
// ===========================================================================

export const GAP_SEVERITIES = ['critical', 'warning', 'info'] as const;
export const GapSeveritySchema = z.enum(GAP_SEVERITIES);
export type GapSeverity = z.infer<typeof GapSeveritySchema>;

// ===========================================================================
// Compliance Gap
// ===========================================================================

export const ComplianceGapSchema = z.object({
  id: z.string(),
  severity: GapSeveritySchema,
  category: GapCategorySchema,
  description: z.string(),
  affectedSurfaces: z.array(z.string()),
  affectedDecisions: z.array(z.string()),
  recommendation: z.string(),
});
export type ComplianceGap = z.infer<typeof ComplianceGapSchema>;

// ===========================================================================
// Compliance Audit Request
// ===========================================================================

export const ComplianceAuditRequestSchema = z.object({
  tenantId: z.string(),
  timeRange: z.object({
    from: z.string(),
    to: z.string(),
  }).optional(),
  surfaces: z.array(z.string()).optional(),
  includeEvidenceIntegrity: z.boolean().optional(),
});
export type ComplianceAuditRequest = z.infer<typeof ComplianceAuditRequestSchema>;

// ===========================================================================
// Gap Count Summary
// ===========================================================================

export const GapCountSchema = z.object({
  critical: z.number().int().nonnegative(),
  warning: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
});
export type GapCount = z.infer<typeof GapCountSchema>;

// ===========================================================================
// Audit Summary
// ===========================================================================

export const AuditSummarySchema = z.object({
  totalDecisions: z.number().int().nonnegative(),
  policyCoverage: z.number().min(0).max(100),
  evidenceIntegrity: z.number().min(0).max(100),
  gapCount: GapCountSchema,
});
export type AuditSummary = z.infer<typeof AuditSummarySchema>;

// ===========================================================================
// Compliance Audit Report
// ===========================================================================

export const ComplianceAuditReportSchema = z.object({
  tenantId: z.string(),
  generatedAt: z.string(),
  timeRange: z.object({
    from: z.string(),
    to: z.string(),
  }),
  summary: AuditSummarySchema,
  gaps: z.array(ComplianceGapSchema),
  recommendations: z.array(z.string()),
});
export type ComplianceAuditReport = z.infer<typeof ComplianceAuditReportSchema>;

// ===========================================================================
// Evidence Integrity Request / Result
// ===========================================================================

export const EvidenceIntegrityRequestSchema = z.object({
  tenantId: z.string(),
  correlationIds: z.array(z.string()),
});
export type EvidenceIntegrityRequest = z.infer<typeof EvidenceIntegrityRequestSchema>;

export const EvidenceIntegrityResultSchema = z.object({
  tenantId: z.string(),
  checked: z.number().int().nonnegative(),
  intact: z.number().int().nonnegative(),
  broken: z.number().int().nonnegative(),
  details: z.array(z.object({
    correlationId: z.string(),
    valid: z.boolean(),
    recordCount: z.number().int().nonnegative(),
    error: z.string().nullable(),
  })),
});
export type EvidenceIntegrityResult = z.infer<typeof EvidenceIntegrityResultSchema>;
