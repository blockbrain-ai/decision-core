/**
 * Memory Evidence Redaction
 *
 * Extended redaction utilities beyond the base secret-pattern detection.
 * Handles PII patterns, email addresses, and phone numbers when flagged as sensitive.
 */

import type { MemoryEvidenceItem, MemoryEvidenceExport } from './memory-evidence.contracts.js';
import { containsSecret } from './memory-evidence.contracts.js';

// ===========================================================================
// PII Patterns
// ===========================================================================

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_PATTERN = /(?:\+\d{1,3}[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const CREDIT_CARD_PATTERN = /\b(\d{4})[-\s](\d{4})[-\s](\d{4})[-\s](\d{4})\b/g;

export function containsPII(text: string): boolean {
  // Reset lastIndex before each test (global flag persists state)
  for (const pattern of [EMAIL_PATTERN, PHONE_PATTERN, SSN_PATTERN, CREDIT_CARD_PATTERN]) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}

export function redactPII(text: string): string {
  return text
    .replace(EMAIL_PATTERN, '[EMAIL_REDACTED]')
    .replace(SSN_PATTERN, '[SSN_REDACTED]')
    .replace(CREDIT_CARD_PATTERN, '[CC_REDACTED]')
    .replace(PHONE_PATTERN, '[PHONE_REDACTED]');
}

// ===========================================================================
// Deep Redaction
// ===========================================================================

export interface RedactionStats {
  totalItems: number;
  secretsRedacted: number;
  piiRedacted: number;
  alreadySensitive: number;
}

export function deepRedactItem(item: MemoryEvidenceItem): {
  item: MemoryEvidenceItem;
  hadSecret: boolean;
  hadPII: boolean;
} {
  const hadSecret = containsSecret(item.summary) || containsSecret(item.sourceRef);
  const hadPII = containsPII(item.summary) || containsPII(item.sourceRef);

  if (!hadSecret && !hadPII) {
    return { item, hadSecret: false, hadPII: false };
  }

  let summary = item.summary;
  let sourceRef = item.sourceRef;

  if (hadSecret) {
    summary = containsSecret(summary) ? '[REDACTED — contained secret material]' : summary;
    sourceRef = containsSecret(sourceRef) ? '[REDACTED]' : sourceRef;
  }

  if (hadPII) {
    summary = redactPII(summary);
    sourceRef = redactPII(sourceRef);
  }

  return {
    item: { ...item, summary, sourceRef, sensitive: true },
    hadSecret,
    hadPII,
  };
}

export function deepRedactExport(exp: MemoryEvidenceExport): {
  export: MemoryEvidenceExport;
  stats: RedactionStats;
} {
  let secretsRedacted = 0;
  let piiRedacted = 0;
  let alreadySensitive = 0;

  const items = exp.items.map((item) => {
    if (item.sensitive) alreadySensitive++;
    const result = deepRedactItem(item);
    if (result.hadSecret) secretsRedacted++;
    if (result.hadPII) piiRedacted++;
    return result.item;
  });

  return {
    export: { ...exp, items },
    stats: {
      totalItems: exp.items.length,
      secretsRedacted,
      piiRedacted,
      alreadySensitive,
    },
  };
}
