import { describe, it, expect } from 'vitest';
import { generateUuidV7, isUuidV7, extractTimestamp } from './uuid-v7.js';

describe('uuid-v7', () => {
  describe('generateUuidV7', () => {
    it('generates a valid UUID v7 string', () => {
      const id = generateUuidV7();
      expect(isUuidV7(id)).toBe(true);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateUuidV7()));
      expect(ids.size).toBe(100);
    });

    it('generates time-ordered IDs', () => {
      const ids = Array.from({ length: 10 }, () => generateUuidV7());
      const sorted = [...ids].sort();
      expect(ids).toEqual(sorted);
    });

    it('has correct version nibble (7)', () => {
      const id = generateUuidV7();
      expect(id[14]).toBe('7');
    });

    it('has correct variant bits (10xx)', () => {
      const id = generateUuidV7();
      const variantChar = id[19]!;
      expect(['8', '9', 'a', 'b']).toContain(variantChar);
    });
  });

  describe('isUuidV7', () => {
    it('returns true for valid UUID v7', () => {
      expect(isUuidV7(generateUuidV7())).toBe(true);
    });

    it('returns false for UUID v4', () => {
      expect(isUuidV7('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });

    it('returns false for garbage', () => {
      expect(isUuidV7('not-a-uuid')).toBe(false);
    });
  });

  describe('extractTimestamp', () => {
    it('extracts a timestamp close to now', () => {
      const before = Date.now();
      const id = generateUuidV7();
      const after = Date.now();
      const ts = extractTimestamp(id);

      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });
});
