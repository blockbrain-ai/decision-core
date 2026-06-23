/**
 * Common Contract Types
 *
 * Shared types used across all Decision Core domains:
 * branded types, envelopes, pagination, and utility shapes.
 */

import { z } from 'zod';

// ===========================================================================
// Branded Types (D2, D3)
// ===========================================================================

export type TenantId = string & { readonly __brand: 'TenantId' };
export type CorrelationId = string & { readonly __brand: 'CorrelationId' };
export type AuditHash = string & { readonly __brand: 'AuditHash' };

export const DEFAULT_TENANT_ID = '_default' as TenantId;

// ===========================================================================
// Risk Classification
// ===========================================================================

export const RISK_CLASSES = ['A', 'B', 'C'] as const;
export const RiskClassSchema = z.enum(RISK_CLASSES);
export type RiskClass = z.infer<typeof RiskClassSchema>;

// ===========================================================================
// Pagination
// ===========================================================================

export const PaginationParamsSchema = z.object({
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type PaginationParams = z.infer<typeof PaginationParamsSchema>;

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    pagination: z.object({
      total: z.number(),
      limit: z.number(),
      offset: z.number(),
      hasMore: z.boolean(),
    }),
  });

// ===========================================================================
// Date Range
// ===========================================================================

export const DateRangeFilterSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});
export type DateRangeFilter = z.infer<typeof DateRangeFilterSchema>;

// ===========================================================================
// API Response Envelope
// ===========================================================================

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    meta: z.object({
      requestId: z.string(),
      timestamp: z.string(),
    }),
  });
