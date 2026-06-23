/**
 * Audit Hash Utility
 *
 * SHA-256 hashing with canonical JSON serialisation for
 * tamper-evident audit records (D3 standard).
 */

import { createHash } from 'node:crypto';
import { serializeForSnapshot } from './golden-snapshot.js';

export function canonicalJson(value: unknown): string {
  return serializeForSnapshot(value);
}

export function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function hashCanonicalJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function hashNormalizedText(text: string): string {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
  return sha256Hex(normalized);
}

export interface ChainEntryInput {
  sequence: number;
  previousHash: string | null;
  payloadHash: string;
  operationType: string;
  /**
   * Optional record timestamp (ISO-8601). When provided it is folded into the
   * audit hash so that re-ordering events in time (mutating a record's
   * timestamp) breaks the chain. Callers that intentionally exclude time from
   * identity — e.g. content-addressed version chains — omit it, which keeps
   * their hashes byte-identical to the timestamp-less computation.
   */
  timestamp?: string;
}

export function hashChainEntry(input: ChainEntryInput): string {
  const entry: Record<string, unknown> = {
    sequence: input.sequence,
    previousHash: input.previousHash,
    payloadHash: input.payloadHash,
    operationType: input.operationType,
  };
  // Only include the timestamp key when supplied so callers that omit it
  // produce the exact same canonical JSON (and hash) as before this change.
  if (input.timestamp !== undefined) {
    entry.timestamp = input.timestamp;
  }
  return hashCanonicalJson(entry);
}
