/**
 * Policy Clause Normalizer
 *
 * Normalizes extracted clause text and computes stable clause keys
 * and content hashes. Ensures identical text always produces the same
 * clauseKey and normalizedHash regardless of formatting variations.
 */

import { hashNormalizedText } from '../../utils/audit-hash.js';
import type { ExtractedClause } from './policy-clause-extractor.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('policy-clause-normalizer');

export interface NormalizedClause {
  text: string;
  normalizedText: string;
  clauseKey: string;
  normalizedHash: string;
  clauseType: ExtractedClause['clauseType'];
  sectionId: string;
  headingPath: string;
  indexInSection: number;
  confidence: number;
}

export function normalizeClauses(clauses: ExtractedClause[]): NormalizedClause[] {
  const normalized = clauses.map(normalizeClause);
  logger.info({ count: normalized.length }, 'normalized clauses');
  return normalized;
}

function normalizeClause(clause: ExtractedClause): NormalizedClause {
  const normalizedText = normalizeText(clause.text);
  const clauseKey = computeClauseKey(clause.headingPath, clause.indexInSection);
  // Use hashNormalizedText on the original text to match the repository's hash computation
  const normalizedHash = hashNormalizedText(clause.text);

  return {
    text: clause.text,
    normalizedText,
    clauseKey,
    normalizedHash,
    clauseType: clause.clauseType,
    sectionId: clause.sectionId,
    headingPath: clause.headingPath,
    indexInSection: clause.indexInSection,
    confidence: clause.confidence,
  };
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function computeClauseKey(headingPath: string, indexInSection: number): string {
  const pathSlug = headingPath
    .toLowerCase()
    .replace(/[^a-z0-9\s>-]/g, '')
    .replace(/\s*>\s*/g, '/')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return `${pathSlug}:${indexInSection}`;
}
