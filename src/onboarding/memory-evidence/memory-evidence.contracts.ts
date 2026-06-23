/**
 * Memory Evidence Contracts
 *
 * Schemas for memory evidence import from any source.
 * The user's agent performs provider-specific reads and returns
 * evidence in this canonical format for Decision Core to ingest.
 */

import { z } from 'zod';
import { MemorySourceKindSchema } from '../../contracts/onboarding-profile.contracts.js';

// ===========================================================================
// Memory Evidence Source Descriptor
// ===========================================================================

export const MemoryEvidenceSourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: MemorySourceKindSchema,
  detectionHints: z.array(z.string()),
  supportedExportFormats: z.array(z.string()),
});
export type MemoryEvidenceSource = z.infer<typeof MemoryEvidenceSourceSchema>;

// ===========================================================================
// Evidence Item
// ===========================================================================

export const MemoryEvidenceItemSchema = z.object({
  id: z.string(),
  summary: z.string(),
  sourceRef: z.string(),
  confidence: z.number().min(0).max(1),
  sensitive: z.boolean().default(false),
  suggestedProfilePatch: z.record(z.unknown()).optional(),
});
export type MemoryEvidenceItem = z.infer<typeof MemoryEvidenceItemSchema>;

// ===========================================================================
// Consent Block
// ===========================================================================

export const MemoryEvidenceConsentSchema = z.object({
  readGranted: z.boolean(),
  writeBackGranted: z.boolean(),
  scope: z.array(z.string()),
});
export type MemoryEvidenceConsent = z.infer<typeof MemoryEvidenceConsentSchema>;

// ===========================================================================
// Evidence Export (top-level import format)
// ===========================================================================

export const COLLECTED_BY_OPTIONS = ['user-agent', 'decision-core', 'manual'] as const;
export const CollectedBySchema = z.enum(COLLECTED_BY_OPTIONS);

export const MemoryEvidenceExportSchema = z.object({
  schemaVersion: z.literal(1),
  sourceId: z.string(),
  sourceKind: MemorySourceKindSchema,
  collectedBy: CollectedBySchema,
  collectedAt: z.string(),
  consent: MemoryEvidenceConsentSchema,
  items: z.array(MemoryEvidenceItemSchema),
});
export type MemoryEvidenceExport = z.infer<typeof MemoryEvidenceExportSchema>;

// ===========================================================================
// Redaction Markers
// ===========================================================================

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/,
  /ghp_[A-Za-z0-9]{36}/,
  /gho_[A-Za-z0-9]{36}/,
  /xox[bpas]-[A-Za-z0-9-]{10,}/,
];

export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(text));
}

export function redactEvidenceItem(item: MemoryEvidenceItem): MemoryEvidenceItem {
  const summaryRedacted = containsSecret(item.summary);
  const refRedacted = containsSecret(item.sourceRef);

  if (!summaryRedacted && !refRedacted) return item;

  return {
    ...item,
    summary: summaryRedacted ? '[REDACTED — contained secret material]' : item.summary,
    sourceRef: refRedacted ? '[REDACTED]' : item.sourceRef,
    sensitive: true,
  };
}

export function redactExport(exp: MemoryEvidenceExport): MemoryEvidenceExport {
  return {
    ...exp,
    items: exp.items.map(redactEvidenceItem),
  };
}

// ===========================================================================
// Validation Helpers
// ===========================================================================

export function validateExport(data: unknown): {
  valid: boolean;
  export?: MemoryEvidenceExport;
  errors?: string[];
} {
  const result = MemoryEvidenceExportSchema.safeParse(data);
  if (result.success) {
    return { valid: true, export: result.data };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  };
}
