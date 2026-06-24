import { describe, it, expect } from 'vitest';
import { canonicalJson, sha256Hex, hashCanonicalJson, hashNormalizedText, hashChainEntry } from './audit-hash.js';

describe('audit-hash', () => {
  describe('canonicalJson', () => {
    it('sorts object keys alphabetically', () => {
      const result = canonicalJson({ z: 1, a: 2, m: 3 });
      expect(result).toBe('{"a":2,"m":3,"z":1}');
    });

    it('sorts nested object keys', () => {
      const result = canonicalJson({ b: { z: 1, a: 2 }, a: 1 });
      expect(result).toBe('{"a":1,"b":{"a":2,"z":1}}');
    });

    it('preserves array order', () => {
      const result = canonicalJson({ arr: [3, 1, 2] });
      expect(result).toBe('{"arr":[3,1,2]}');
    });

    it('serializes Date values as ISO strings', () => {
      const result = canonicalJson({ at: new Date('2026-06-24T00:00:00.000Z') });
      expect(result).toBe('{"at":"2026-06-24T00:00:00.000Z"}');
    });

    it('rejects unsupported values instead of silently coercing them', () => {
      expect(() => canonicalJson(undefined)).toThrow('undefined');
      expect(() => canonicalJson({ value: undefined })).toThrow('undefined');
      expect(() => canonicalJson({ value: Number.NaN })).toThrow('non-finite');
      expect(() => canonicalJson({ value: Infinity })).toThrow('non-finite');
      expect(() => canonicalJson({ value: 1n })).toThrow('BigInt');
      expect(() => canonicalJson({ value: () => undefined })).toThrow('function');
      expect(() => canonicalJson({ value: Symbol('x') })).toThrow('symbol');
    });

    it('rejects circular structures', () => {
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;
      expect(() => canonicalJson(circular)).toThrow('circular');
    });
  });

  describe('sha256Hex', () => {
    it('produces a 64-character hex string', () => {
      const hash = sha256Hex('hello');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces deterministic output', () => {
      expect(sha256Hex('test')).toBe(sha256Hex('test'));
    });
  });

  describe('hashCanonicalJson', () => {
    it('produces deterministic hashes for identical inputs', () => {
      const a = hashCanonicalJson({ x: 1, y: 2 });
      const b = hashCanonicalJson({ y: 2, x: 1 });
      expect(a).toBe(b);
    });

    it('produces different hashes for different inputs', () => {
      const a = hashCanonicalJson({ x: 1 });
      const b = hashCanonicalJson({ x: 2 });
      expect(a).not.toBe(b);
    });

    it('handles nested objects deterministically', () => {
      const a = hashCanonicalJson({ outer: { z: 1, a: 2 } });
      const b = hashCanonicalJson({ outer: { a: 2, z: 1 } });
      expect(a).toBe(b);
    });
  });

  describe('hashNormalizedText', () => {
    it('normalizes line endings', () => {
      const a = hashNormalizedText('line1\r\nline2');
      const b = hashNormalizedText('line1\nline2');
      expect(a).toBe(b);
    });

    it('trims trailing whitespace', () => {
      const a = hashNormalizedText('line1   \nline2  ');
      const b = hashNormalizedText('line1\nline2');
      expect(a).toBe(b);
    });
  });

  describe('hashChainEntry', () => {
    it('produces deterministic chain hashes', () => {
      const input = { sequence: 0, previousHash: null, payloadHash: 'abc', operationType: 'create' };
      expect(hashChainEntry(input)).toBe(hashChainEntry(input));
    });

    it('changes when any field changes', () => {
      const base = { sequence: 0, previousHash: null, payloadHash: 'abc', operationType: 'create' };
      const altered = { ...base, sequence: 1 };
      expect(hashChainEntry(base)).not.toBe(hashChainEntry(altered));
    });

    it('folds the timestamp into the hash when provided', () => {
      const base = { sequence: 0, previousHash: null, payloadHash: 'abc', operationType: 'create' };
      const t1 = { ...base, timestamp: '2026-06-23T00:00:00.000Z' };
      const t2 = { ...base, timestamp: '2026-06-23T00:00:01.000Z' };
      // A different timestamp yields a different hash (re-ordering breaks the chain)...
      expect(hashChainEntry(t1)).not.toBe(hashChainEntry(t2));
      // ...and a timestamped entry differs from the timestamp-less computation.
      expect(hashChainEntry(t1)).not.toBe(hashChainEntry(base));
    });

    it('omitting the timestamp preserves the legacy (timestamp-less) hash', () => {
      const entry = { sequence: 2, previousHash: 'prev', payloadHash: 'abc', operationType: 'clause_version' };
      // Byte-identical to the pre-change 4-key canonical-JSON computation, so
      // content-addressed chains (e.g. clause versions) keep their hashes.
      const legacy = sha256Hex(canonicalJson({
        sequence: 2,
        previousHash: 'prev',
        payloadHash: 'abc',
        operationType: 'clause_version',
      }));
      expect(hashChainEntry(entry)).toBe(legacy);
      // Deterministic for the no-timestamp path.
      expect(hashChainEntry(entry)).toBe(hashChainEntry({ ...entry }));
    });
  });
});
