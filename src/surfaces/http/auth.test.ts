/**
 * Auth module tests — bearer token generation, timing-safe validation.
 */

import { describe, it, expect } from 'vitest';
import { validateBearerToken, generateToken, extractToken, timingSafeCompare } from './auth.js';
import type { IncomingMessage } from 'node:http';

function mockReq(authHeader?: string): IncomingMessage {
  return { headers: { authorization: authHeader } } as unknown as IncomingMessage;
}

describe('generateToken', () => {
  it('generates a 64-character hex string', () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique tokens (cryptographic randomness)', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateToken()));
    expect(tokens.size).toBe(20);
  });

  it('has sufficient entropy (32 bytes)', () => {
    const token = generateToken();
    // 32 bytes = 64 hex chars
    expect(token.length).toBe(64);
    // Byte distribution: no single hex digit should dominate
    const charCounts = new Map<string, number>();
    for (const c of token) {
      charCounts.set(c, (charCounts.get(c) ?? 0) + 1);
    }
    // With 64 chars and 16 possible hex digits, average is 4 per digit.
    // Ensure no digit exceeds 20 occurrences (extremely unlikely for random).
    for (const count of charCounts.values()) {
      expect(count).toBeLessThan(20);
    }
  });
});

describe('extractToken', () => {
  it('returns undefined for undefined header', () => {
    expect(extractToken(undefined)).toBeUndefined();
  });

  it('strips Bearer prefix', () => {
    expect(extractToken('Bearer abc123')).toBe('abc123');
  });

  it('returns raw token when no prefix', () => {
    expect(extractToken('abc123')).toBe('abc123');
  });
});

describe('timingSafeCompare', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeCompare('hello', 'hello')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(timingSafeCompare('hello', 'world')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(timingSafeCompare('short', 'a-longer-string')).toBe(false);
  });

  it('returns false for empty vs non-empty', () => {
    expect(timingSafeCompare('', 'notempty')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(timingSafeCompare('', '')).toBe(true);
  });
});

describe('validateBearerToken', () => {
  it('returns true when no token is configured', () => {
    expect(validateBearerToken(mockReq(), undefined)).toBe(true);
  });

  it('returns false when token configured but no header', () => {
    expect(validateBearerToken(mockReq(), 'secret')).toBe(false);
  });

  it('returns false when token does not match', () => {
    expect(validateBearerToken(mockReq('Bearer wrong'), 'secret')).toBe(false);
  });

  it('returns true when token matches with Bearer prefix', () => {
    expect(validateBearerToken(mockReq('Bearer secret'), 'secret')).toBe(true);
  });

  it('returns true when token matches without prefix', () => {
    expect(validateBearerToken(mockReq('secret'), 'secret')).toBe(true);
  });

  it('rejects token that is a prefix of the expected token', () => {
    expect(validateBearerToken(mockReq('Bearer sec'), 'secret')).toBe(false);
  });

  it('rejects token that extends the expected token', () => {
    expect(validateBearerToken(mockReq('Bearer secret-extra'), 'secret')).toBe(false);
  });

  it('works with generated tokens', () => {
    const token = generateToken();
    expect(validateBearerToken(mockReq(`Bearer ${token}`), token)).toBe(true);
    expect(validateBearerToken(mockReq('Bearer notthetoken'), token)).toBe(false);
  });
});
