import { z } from 'zod';

// ===========================================================================
// Provenance Metadata Schema
// ===========================================================================

export const ProvenanceMetadataSchema = z.object({
  compilerVersion: z.string(),
  authoringSchemaVersion: z.string().optional(),
  policyFileHash: z.string().optional(),
  linterStatus: z
    .object({
      errorCount: z.number().int().nonnegative(),
      warningCount: z.number().int().nonnegative(),
      lintedAt: z.string(),
    })
    .optional(),
  ruleSetHash: z.string().optional(),
  sourceDocumentId: z.string().optional(),
});
export type ProvenanceMetadata = z.infer<typeof ProvenanceMetadataSchema>;

export const COMPILER_VERSION = '1.0.0';

export interface BuildProvenanceOptions {
  authoringSchemaVersion?: string;
  policyFileHash?: string;
  linterStatus?: { errorCount: number; warningCount: number; lintedAt: string };
  ruleSetHash?: string;
  sourceDocumentId?: string;
}

export function buildProvenanceMetadata(options?: BuildProvenanceOptions): ProvenanceMetadata {
  return {
    compilerVersion: COMPILER_VERSION,
    authoringSchemaVersion: options?.authoringSchemaVersion,
    policyFileHash: options?.policyFileHash,
    linterStatus: options?.linterStatus,
    ruleSetHash: options?.ruleSetHash,
    sourceDocumentId: options?.sourceDocumentId,
  };
}
