import { describe, it, expect } from 'vitest';
import { resolveAutonomyMode, applyAutonomyEffect } from './autonomy-level.js';

describe('resolveAutonomyMode', () => {
  it('returns strict for autonomy levels 0-1', () => {
    expect(resolveAutonomyMode(0)).toBe('strict');
    expect(resolveAutonomyMode(1)).toBe('strict');
  });

  it('returns permissive for autonomy levels 2-3', () => {
    expect(resolveAutonomyMode(2)).toBe('permissive');
    expect(resolveAutonomyMode(3)).toBe('permissive');
  });

  it('returns advisory for autonomy levels 4-5', () => {
    expect(resolveAutonomyMode(4)).toBe('advisory');
    expect(resolveAutonomyMode(5)).toBe('advisory');
  });
});

describe('applyAutonomyEffect', () => {
  describe('strict mode', () => {
    it('blocks on deny', () => {
      const effect = applyAutonomyEffect('deny', 'strict');
      expect(effect.shouldBlock).toBe(true);
      expect(effect.effectiveVerdict).toBe('deny');
    });

    it('blocks on approve_required', () => {
      const effect = applyAutonomyEffect('approve_required', 'strict');
      expect(effect.shouldBlock).toBe(true);
      expect(effect.effectiveVerdict).toBe('approve_required');
    });

    it('allows on allow', () => {
      const effect = applyAutonomyEffect('allow', 'strict');
      expect(effect.shouldBlock).toBe(false);
      expect(effect.effectiveVerdict).toBe('allow');
    });
  });

  describe('permissive mode', () => {
    it('blocks on deny', () => {
      const effect = applyAutonomyEffect('deny', 'permissive');
      expect(effect.shouldBlock).toBe(true);
      expect(effect.effectiveVerdict).toBe('deny');
    });

    it('does NOT block on approve_required (relaxes to allow)', () => {
      const effect = applyAutonomyEffect('approve_required', 'permissive');
      expect(effect.shouldBlock).toBe(false);
      expect(effect.effectiveVerdict).toBe('allow');
    });

    it('allows on allow', () => {
      const effect = applyAutonomyEffect('allow', 'permissive');
      expect(effect.shouldBlock).toBe(false);
      expect(effect.effectiveVerdict).toBe('allow');
    });
  });

  describe('advisory mode', () => {
    it('never blocks — even on deny', () => {
      const effect = applyAutonomyEffect('deny', 'advisory');
      expect(effect.shouldBlock).toBe(false);
      expect(effect.effectiveVerdict).toBe('deny');
    });

    it('never blocks on approve_required', () => {
      const effect = applyAutonomyEffect('approve_required', 'advisory');
      expect(effect.shouldBlock).toBe(false);
      expect(effect.effectiveVerdict).toBe('approve_required');
    });

    it('allows on allow', () => {
      const effect = applyAutonomyEffect('allow', 'advisory');
      expect(effect.shouldBlock).toBe(false);
      expect(effect.effectiveVerdict).toBe('allow');
    });
  });
});
