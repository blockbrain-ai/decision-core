/**
 * G-Brain Adapter Contracts
 *
 * Zod schemas for G-Brain integration types:
 * context retrieval, decision storage, and slug validation.
 */

import { z } from 'zod';

// ===========================================================================
// Slug Validation
// ===========================================================================

export const SLUG_PREFIX = 'decisions/';

export const GBrainSlugSchema = z.string().refine(
  (s) => s.startsWith(SLUG_PREFIX),
  { message: `Slug must start with "${SLUG_PREFIX}"` },
);
export type GBrainSlug = z.infer<typeof GBrainSlugSchema>;

// ===========================================================================
// G-Brain Page
// ===========================================================================

export const GBrainPageSchema = z.object({
  slug: z.string(),
  title: z.string(),
  content: z.string(),
  entities: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type GBrainPage = z.infer<typeof GBrainPageSchema>;

// ===========================================================================
// Context Retrieval
// ===========================================================================

export const GBrainContextRequestSchema = z.object({
  tenantId: z.string(),
  surfaceId: z.string(),
  action: z.string(),
  maxResults: z.number().int().positive().optional(),
});
export type GBrainContextRequest = z.infer<typeof GBrainContextRequestSchema>;

export const GBrainContextSchema = z.object({
  pages: z.array(GBrainPageSchema),
  query: z.string(),
  totalResults: z.number(),
});
export type GBrainContext = z.infer<typeof GBrainContextSchema>;

// ===========================================================================
// Decision Storage
// ===========================================================================

export const GBrainStoreRequestSchema = z.object({
  tenantId: z.string(),
  surfaceId: z.string(),
  decisionId: z.string(),
  decision: z.record(z.unknown()),
  evidence: z.record(z.unknown()).optional(),
  entities: z.array(z.string()).optional(),
});
export type GBrainStoreRequest = z.infer<typeof GBrainStoreRequestSchema>;

export const StoredPageSchema = z.object({
  slug: z.string(),
  title: z.string(),
  createdAt: z.string(),
  entities: z.array(z.string()),
});
export type StoredPage = z.infer<typeof StoredPageSchema>;

// ===========================================================================
// Client Operations
// ===========================================================================

export const GBrainSearchParamsSchema = z.object({
  query: z.string(),
  slugPrefix: z.string().optional(),
  limit: z.number().int().positive().optional(),
});
export type GBrainSearchParams = z.infer<typeof GBrainSearchParamsSchema>;

export const GBrainPutPageParamsSchema = z.object({
  slug: z.string(),
  title: z.string(),
  content: z.string(),
  entities: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type GBrainPutPageParams = z.infer<typeof GBrainPutPageParamsSchema>;
