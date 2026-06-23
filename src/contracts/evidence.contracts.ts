/**
 * Evidence Contract Types
 *
 * Production schemas for the evidence chain system.
 * Provides tamper-evident audit records per D3 standard.
 * Hash-linked evidence chains with tamper detection and historical replay.
 */

import { z } from 'zod';

// ===========================================================================
// Evidence Operation Types
// ===========================================================================

export const EVIDENCE_OPERATION_TYPES = [
  'input_received',
  'policy_evaluation',
  'clause_reference',
  'route_decision',
  'approval_request',
  'approval_response',
  'final_verdict',
] as const;
export const EvidenceOperationTypeSchema = z.enum(EVIDENCE_OPERATION_TYPES);
export type EvidenceOperationType = z.infer<typeof EvidenceOperationTypeSchema>;

// ===========================================================================
// Evidence Record
// ===========================================================================

export const EvidenceRecordSchema = z.object({
  id: z.string(),
  correlationId: z.string(),
  timestamp: z.string(),
  tenantId: z.string(),
  auditHash: z.string(),
  operationType: z.string(),
  payload: z.record(z.unknown()),
  sequence: z.number().int().nonnegative(),
  previousHash: z.string().nullable(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

export const EvidenceRecordCreateInputSchema = EvidenceRecordSchema.omit({
  id: true,
  auditHash: true,
  sequence: true,
  previousHash: true,
});
export type EvidenceRecordCreateInput = z.infer<typeof EvidenceRecordCreateInputSchema>;

// ===========================================================================
// Evidence Chain
// ===========================================================================

export const EvidenceChainSchema = z.object({
  tenantId: z.string(),
  correlationId: z.string(),
  records: z.array(EvidenceRecordSchema),
  headHash: z.string().nullable(),
});
export type EvidenceChain = z.infer<typeof EvidenceChainSchema>;

// ===========================================================================
// Chain Verification Result
// ===========================================================================

export const ChainVerificationResultSchema = z.object({
  valid: z.boolean(),
  recordCount: z.number().int().nonnegative(),
  brokenAt: z.number().int().nullable(),
  brokenRecordId: z.string().nullable(),
  expectedHash: z.string().nullable(),
  actualHash: z.string().nullable(),
  error: z.string().nullable(),
});
export type ChainVerificationResult = z.infer<typeof ChainVerificationResultSchema>;

// ===========================================================================
// Clause Version Entry
// ===========================================================================

export const ClauseVersionEntrySchema = z.object({
  clauseId: z.string(),
  version: z.number().int().positive(),
  text: z.string(),
  normalizedHash: z.string(),
  previousVersionHash: z.string().nullable(),
  chainHash: z.string(),
  effectiveDate: z.string(),
  tenantId: z.string(),
  correlationId: z.string(),
});
export type ClauseVersionEntry = z.infer<typeof ClauseVersionEntrySchema>;

// ===========================================================================
// Clause Version Chain
// ===========================================================================

export const ClauseVersionChainSchema = z.object({
  clauseId: z.string(),
  tenantId: z.string(),
  versions: z.array(ClauseVersionEntrySchema),
  headHash: z.string().nullable(),
});
export type ClauseVersionChain = z.infer<typeof ClauseVersionChainSchema>;

// ===========================================================================
// Historical Replay Request / Result
// ===========================================================================

export const HistoricalReplayRequestSchema = z.object({
  tenantId: z.string(),
  correlationId: z.string(),
  decisionId: z.string(),
});
export type HistoricalReplayRequest = z.infer<typeof HistoricalReplayRequestSchema>;

export const PolicySnapshotSchema = z.object({
  ruleSetId: z.string(),
  ruleSetVersion: z.number().int().positive(),
  clauseIds: z.array(z.string()),
  activatedAt: z.string(),
  snapshotHash: z.string(),
});
export type PolicySnapshot = z.infer<typeof PolicySnapshotSchema>;

export const HistoricalReplayResultSchema = z.object({
  decisionId: z.string(),
  tenantId: z.string(),
  correlationId: z.string(),
  timestamp: z.string(),
  policySnapshot: PolicySnapshotSchema,
  evidenceChain: EvidenceChainSchema,
  chainVerification: ChainVerificationResultSchema,
});
export type HistoricalReplayResult = z.infer<typeof HistoricalReplayResultSchema>;
