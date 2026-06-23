/**
 * Golden Snapshot Utility
 *
 * Provides deterministic JSON serialisation (sorted keys, stable output) and
 * SHA-256 hashing for decision-log input snapshots.
 */

import { createHash } from 'node:crypto';

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/**
 * Serialise `data` to a deterministic JSON string.
 * Object keys are sorted alphabetically at every depth level.
 */
export function serializeForSnapshot(data: unknown): string {
  if (data === undefined) return '"undefined"';
  return JSON.stringify(data, sortedReplacer);
}

/**
 * Compute the SHA-256 hex digest of a serialised snapshot string.
 */
export function hashSnapshot(serialized: string): string {
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}
