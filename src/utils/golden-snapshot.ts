/**
 * Golden Snapshot Utility
 *
 * Provides deterministic JSON serialisation (sorted keys, stable output) and
 * SHA-256 hashing for decision-log input snapshots.
 */

import { createHash } from 'node:crypto';

function serializeValue(data: unknown, seen: WeakSet<object>): string {
  if (data === null) return 'null';

  switch (typeof data) {
    case 'string':
      return JSON.stringify(data);
    case 'boolean':
      return data ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(data)) {
        throw new TypeError('Cannot canonicalize non-finite number');
      }
      return JSON.stringify(data);
    case 'undefined':
      throw new TypeError('Cannot canonicalize undefined');
    case 'bigint':
      throw new TypeError('Cannot canonicalize BigInt');
    case 'function':
      throw new TypeError('Cannot canonicalize function');
    case 'symbol':
      throw new TypeError('Cannot canonicalize symbol');
    case 'object':
      break;
  }

  if (data instanceof Date) {
    const time = data.getTime();
    if (!Number.isFinite(time)) {
      throw new TypeError('Cannot canonicalize invalid Date');
    }
    return JSON.stringify(data.toISOString());
  }

  if (seen.has(data)) {
    throw new TypeError('Cannot canonicalize circular structure');
  }
  seen.add(data);

  try {
    if (Array.isArray(data)) {
      return `[${data.map((item) => serializeValue(item, seen)).join(',')}]`;
    }

    const record = data as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeValue(record[key], seen)}`);
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(data);
  }
}

/**
 * Serialise `data` to a deterministic JSON string.
 * Object keys are sorted alphabetically at every depth level.
 */
export function serializeForSnapshot(data: unknown): string {
  return serializeValue(data, new WeakSet<object>());
}

/**
 * Compute the SHA-256 hex digest of a serialised snapshot string.
 */
export function hashSnapshot(serialized: string): string {
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}
