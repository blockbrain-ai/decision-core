/**
 * Memory Evidence Importer
 *
 * Validates, redacts, and imports MemoryEvidenceExport objects from any source.
 * Does not perform provider-specific reads — the user's agent supplies the export.
 */

import type { MemoryEvidenceExport } from './memory-evidence.contracts.js';
import {
  MemoryEvidenceExportSchema,
  redactExport,
} from './memory-evidence.contracts.js';

// ===========================================================================
// Import Result
// ===========================================================================

export interface EvidenceImportResult {
  success: boolean;
  sourceId: string;
  sourceKind: string;
  itemCount: number;
  redactedCount: number;
  skippedCount: number;
  errors: string[];
  export?: MemoryEvidenceExport;
}

// ===========================================================================
// Import Options
// ===========================================================================

export interface EvidenceImportOptions {
  maxItems?: number;
  maxSummaryLength?: number;
  rejectWithoutConsent?: boolean;
}

const DEFAULT_OPTIONS: Required<EvidenceImportOptions> = {
  maxItems: 100,
  maxSummaryLength: 2000,
  rejectWithoutConsent: true,
};

// ===========================================================================
// Importer
// ===========================================================================

export function importMemoryEvidence(
  data: unknown,
  options?: EvidenceImportOptions,
): EvidenceImportResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const errors: string[] = [];

  const parseResult = MemoryEvidenceExportSchema.safeParse(data);
  if (!parseResult.success) {
    return {
      success: false,
      sourceId: (data as { sourceId?: string })?.sourceId ?? 'unknown',
      sourceKind: (data as { sourceKind?: string })?.sourceKind ?? 'unknown',
      itemCount: 0,
      redactedCount: 0,
      skippedCount: 0,
      errors: parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }

  let exp = parseResult.data;

  if (opts.rejectWithoutConsent && !exp.consent.readGranted) {
    return {
      success: false,
      sourceId: exp.sourceId,
      sourceKind: exp.sourceKind,
      itemCount: 0,
      redactedCount: 0,
      skippedCount: 0,
      errors: ['Read consent not granted'],
    };
  }

  let skippedCount = 0;
  if (exp.items.length > opts.maxItems) {
    skippedCount = exp.items.length - opts.maxItems;
    errors.push(`Truncated ${skippedCount} items (max ${opts.maxItems})`);
    exp = { ...exp, items: exp.items.slice(0, opts.maxItems) };
  }

  exp = {
    ...exp,
    items: exp.items.map((item) => {
      if (item.summary.length > opts.maxSummaryLength) {
        return { ...item, summary: item.summary.slice(0, opts.maxSummaryLength) + '...' };
      }
      return item;
    }),
  };

  const redacted = redactExport(exp);
  const redactedCount = redacted.items.filter(
    (item, i) => item.summary !== exp.items[i].summary || item.sourceRef !== exp.items[i].sourceRef,
  ).length;

  return {
    success: true,
    sourceId: redacted.sourceId,
    sourceKind: redacted.sourceKind,
    itemCount: redacted.items.length,
    redactedCount,
    skippedCount,
    errors,
    export: redacted,
  };
}

export function importMultipleExports(
  exports: unknown[],
  options?: EvidenceImportOptions,
): EvidenceImportResult[] {
  return exports.map((exp) => importMemoryEvidence(exp, options));
}
