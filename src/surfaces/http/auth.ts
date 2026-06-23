/**
 * HTTP Bearer Token Auth
 *
 * Cryptographic bearer token generation and timing-safe validation.
 * Tokens are 32 random bytes (64 hex chars) via crypto.getRandomValues.
 * Comparison uses constant-time algorithm to prevent timing attacks.
 */

import type { IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

/**
 * Extract bearer token from Authorization header.
 * Accepts both "Bearer <token>" and raw token formats.
 */
export function extractToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
}

/**
 * Timing-safe string comparison for tokens.
 * Both strings are encoded to UTF-8 buffers; if lengths differ the comparison
 * still runs in constant time by comparing the expected token against itself
 * (and returning false).
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');

  if (bufA.length !== bufB.length) {
    // Compare bufA against itself to maintain constant time, then return false
    timingSafeEqual(bufA, bufA);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

/**
 * Validate bearer token from request headers.
 * Returns true if auth is valid or no token is configured.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function validateBearerToken(
  req: IncomingMessage,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken) return true;
  const token = extractToken(req.headers['authorization']);
  if (!token) return false;
  return timingSafeCompare(token, expectedToken);
}

/**
 * Generate a cryptographically random bearer token.
 * Returns 64-character hex string (32 bytes of entropy).
 */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
