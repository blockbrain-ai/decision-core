import { describe, it, expect } from 'vitest';
import { globMatches, globToRegex } from './glob-matcher.js';

describe('globMatches', () => {
  it('matches exact literal', () => {
    expect(globMatches('finance.delete', 'finance.delete')).toBe(true);
    expect(globMatches('finance.delete', 'finance.create')).toBe(false);
  });

  it('matches single-segment wildcard (*.delete)', () => {
    expect(globMatches('*.delete', 'finance.delete')).toBe(true);
    expect(globMatches('*.delete', 'hr.delete')).toBe(true);
    expect(globMatches('*.delete', 'finance.create')).toBe(false);
    // single * should not cross dot boundaries
    expect(globMatches('*.delete', 'a.b.delete')).toBe(false);
  });

  it('matches prefix wildcard (finance.*)', () => {
    expect(globMatches('finance.*', 'finance.delete')).toBe(true);
    expect(globMatches('finance.*', 'finance.create')).toBe(true);
    expect(globMatches('finance.*', 'hr.delete')).toBe(false);
  });

  it('matches double-star wildcard (**) — everything', () => {
    expect(globMatches('**', 'finance.delete')).toBe(true);
    expect(globMatches('**', 'anything')).toBe(true);
    expect(globMatches('**', 'a.b.c.d')).toBe(true);
    expect(globMatches('**', '')).toBe(true);
  });

  it('matches multi-segment with double-star (finance.**)', () => {
    expect(globMatches('finance.**', 'finance.payments.delete')).toBe(true);
    expect(globMatches('finance.**', 'finance.create')).toBe(true);
    expect(globMatches('finance.**', 'hr.delete')).toBe(false);
  });

  it('does not match partial strings', () => {
    expect(globMatches('finance', 'finance.delete')).toBe(false);
    expect(globMatches('finance.delete', 'finance')).toBe(false);
  });
});

describe('globToRegex', () => {
  it('returns a RegExp', () => {
    expect(globToRegex('*.test')).toBeInstanceOf(RegExp);
  });

  it('escapes special regex characters in the literal parts', () => {
    // Dots in the pattern should be literal, not regex wildcards
    const regex = globToRegex('finance.delete');
    expect(regex.test('financexdelete')).toBe(false);
    expect(regex.test('finance.delete')).toBe(true);
  });
});
