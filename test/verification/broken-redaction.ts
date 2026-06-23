/**
 * Broken Redaction — Leaks restricted payload content in error messages.
 *
 * Mutation: PII detection returns false, redaction returns raw text unchanged,
 * and deep redaction passes items through without redacting secrets or PII.
 * When swapped in, exfiltration tests must fail because sensitive data leaks
 * through error responses and exports.
 */

import type { MemoryEvidenceItem, MemoryEvidenceExport } from '../../src/onboarding/memory-evidence/memory-evidence.contracts.js';
import type { RedactionStats } from '../../src/onboarding/memory-evidence/memory-evidence-redaction.js';

/**
 * Never detects PII — always returns false.
 */
export function brokenContainsPII(_text: string): boolean {
  return false;
}

/**
 * Returns text unchanged — no redaction applied.
 */
export function brokenRedactPII(text: string): string {
  return text;
}

/**
 * Passes item through without any redaction — secrets and PII are leaked.
 */
export function brokenDeepRedactItem(item: MemoryEvidenceItem): {
  item: MemoryEvidenceItem;
  hadSecret: boolean;
  hadPII: boolean;
} {
  return { item, hadSecret: false, hadPII: false };
}

/**
 * Passes export through without any redaction — all data leaked.
 */
export function brokenDeepRedactExport(exp: MemoryEvidenceExport): {
  export: MemoryEvidenceExport;
  stats: RedactionStats;
} {
  return {
    export: exp,
    stats: {
      totalItems: exp.items.length,
      secretsRedacted: 0,
      piiRedacted: 0,
      alreadySensitive: 0,
    },
  };
}
