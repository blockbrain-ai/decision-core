/**
 * UUID v7 Generation Utility
 *
 * Produces time-sortable, globally unique identifiers per RFC 9562.
 * High 48 bits encode Unix timestamp in milliseconds, remaining bits
 * are filled with cryptographic randomness. This makes UUID v7 IDs
 * lexicographically ordered by creation time.
 */

import { randomBytes } from 'node:crypto';

let lastTimestamp = 0;
let counter = 0;

/**
 * Generate a UUID v7 (time-sortable, globally unique).
 *
 * Layout (128 bits):
 *   0-47:  Unix timestamp in milliseconds
 *   48-51: Version (0b0111 = 7)
 *   52-63: Monotonic counter (12 bits, reset on new ms)
 *   64-65: Variant (0b10)
 *   66-127: Random bits
 */
export function generateUuidV7(): string {
  const now = Date.now();

  if (now === lastTimestamp) {
    counter++;
  } else {
    lastTimestamp = now;
    counter = 0;
  }

  const rand = randomBytes(8);

  const bytes = new Uint8Array(16);
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;

  bytes[8] = 0x80 | (rand[0]! & 0x3f);
  bytes[9] = rand[1]!;

  bytes[10] = rand[2]!;
  bytes[11] = rand[3]!;
  bytes[12] = rand[4]!;
  bytes[13] = rand[5]!;
  bytes[14] = rand[6]!;
  bytes[15] = rand[7]!;

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Validate that a string is a well-formed UUID v7.
 */
export function isUuidV7(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Extract the timestamp (milliseconds since epoch) from a UUID v7.
 */
export function extractTimestamp(uuidV7: string): number {
  const hex = uuidV7.replace(/-/g, '').slice(0, 12);
  return parseInt(hex, 16);
}
