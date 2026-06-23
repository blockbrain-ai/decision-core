/**
 * Approval Contract Types
 *
 * Defines types for the approval lifecycle including
 * request records, statuses, priorities, and resolution.
 */

import { z } from 'zod';
import { RiskClassSchema } from './common.contracts.js';

// ===========================================================================
// Status Enums
// ===========================================================================

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired', 'cancelled'] as const;
export const ApprovalStatusSchema = z.enum(APPROVAL_STATUSES);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const APPROVAL_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const ApprovalPrioritySchema = z.enum(APPROVAL_PRIORITIES);
export type ApprovalPriority = z.infer<typeof ApprovalPrioritySchema>;

// ===========================================================================
// Constraint Snapshot
// ===========================================================================

export const CONSTRAINT_STATES = ['green', 'yellow', 'red'] as const;
export const ConstraintStateSchema = z.enum(CONSTRAINT_STATES);
export type ConstraintState = z.infer<typeof ConstraintStateSchema>;

export const ConstraintSnapshotEntrySchema = z.object({
  constraintId: z.string(),
  state: ConstraintStateSchema,
  value: z.number(),
  unit: z.string(),
  driftPercentage: z.number().optional(),
});
export type ConstraintSnapshotEntry = z.infer<typeof ConstraintSnapshotEntrySchema>;

// ===========================================================================
// Approval Request
// ===========================================================================

export const ApprovalRequestSchema = z.object({
  id: z.string(),
  actionType: z.string(),
  riskClass: RiskClassSchema,
  status: ApprovalStatusSchema,
  priority: ApprovalPrioritySchema,
  requestedBy: z.string(),
  requestedAt: z.string(),
  expiresAt: z.string(),
  constraintDrift: z.boolean(),
  policyRuleId: z.string(),
  actionPayload: z.record(z.unknown()),
  constraintSnapshot: z.array(ConstraintSnapshotEntrySchema),
  currentConstraints: z.array(ConstraintSnapshotEntrySchema),
  executionStatus: z.string().optional(),
  executedAt: z.string().optional(),
  executionResult: z.record(z.unknown()).optional(),
  rollbackAvailable: z.boolean().optional(),
  resolvedBy: z.string().optional(),
  resolvedAt: z.string().optional(),
  resolutionNotes: z.string().optional(),
  assignedToRole: z.string().optional(),
  assignedToAgent: z.string().optional(),
  correlationId: z.string(),
  tenantId: z.string(),
  auditHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

// ===========================================================================
// Approval Create Input
// ===========================================================================

export const ApprovalCreateInputSchema = ApprovalRequestSchema.omit({
  id: true,
  tenantId: true,
  auditHash: true,
  createdAt: true,
  updatedAt: true,
  resolvedBy: true,
  resolvedAt: true,
  resolutionNotes: true,
  executionStatus: true,
  executedAt: true,
  executionResult: true,
  rollbackAvailable: true,
});
export type ApprovalCreateInput = z.infer<typeof ApprovalCreateInputSchema>;

// ===========================================================================
// Approval Resolution
// ===========================================================================

export const ApprovalResolutionSchema = z.object({
  resolvedBy: z.string().optional(),
  resolutionNotes: z.string(),
});
export type ApprovalResolution = z.infer<typeof ApprovalResolutionSchema>;

// ===========================================================================
// Approval Filters
// ===========================================================================

export const ApprovalFiltersSchema = z.object({
  status: z.array(ApprovalStatusSchema).optional(),
  priority: z.array(ApprovalPrioritySchema).optional(),
  riskClass: RiskClassSchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
});
export type ApprovalFilters = z.infer<typeof ApprovalFiltersSchema>;

// ===========================================================================
// Approval Stats
// ===========================================================================

export const ApprovalStatsSchema = z.object({
  pending: z.number(),
  overdue: z.number(),
  approvedToday: z.number(),
  rejectedToday: z.number(),
});
export type ApprovalStats = z.infer<typeof ApprovalStatsSchema>;
