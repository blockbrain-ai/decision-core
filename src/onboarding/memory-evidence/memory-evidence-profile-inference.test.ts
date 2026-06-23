import { describe, it, expect } from 'vitest';
import {
  inferProfileFromEvidence,
  applyInferenceToProfile,
} from './memory-evidence-profile-inference.js';
import { createEmptyProfile } from '../../contracts/onboarding-profile.contracts.js';
import type { MemoryEvidenceExport } from './memory-evidence.contracts.js';

function makeExport(items: Array<{ summary: string; confidence?: number; patch?: Record<string, unknown> }>): MemoryEvidenceExport {
  return {
    schemaVersion: 1,
    sourceId: 'test',
    sourceKind: 'gbrain',
    collectedBy: 'user-agent',
    collectedAt: '2026-01-01T00:00:00.000Z',
    consent: { readGranted: true, writeBackGranted: false, scope: ['onboarding'] },
    items: items.map((item, i) => ({
      id: `item-${i}`,
      summary: item.summary,
      sourceRef: `ref-${i}`,
      confidence: item.confidence ?? 0.8,
      sensitive: false,
      suggestedProfilePatch: item.patch,
    })),
  };
}

describe('memory-evidence-profile-inference', () => {
  describe('inferProfileFromEvidence', () => {
    it('returns empty inference for no exports', () => {
      const result = inferProfileFromEvidence([]);
      expect(result.itemsUsed).toBe(0);
      expect(result.suggestedMode).toBeUndefined();
      expect(result.suggestedPosture).toBeUndefined();
      expect(result.suggestedDataClasses).toEqual([]);
      expect(result.suggestedJobs).toEqual([]);
    });

    it('infers business mode from keyword signals', () => {
      const exp = makeExport([
        { summary: 'This is a business operations agent' },
        { summary: 'Manages company workflows' },
      ]);
      const result = inferProfileFromEvidence([exp]);
      expect(result.suggestedMode).toBe('business');
    });

    it('infers enterprise mode from compliance signals', () => {
      const exp = makeExport([
        { summary: 'Enterprise compliance requirements' },
        { summary: 'Regulated financial operations' },
      ]);
      const result = inferProfileFromEvidence([exp]);
      expect(result.suggestedMode).toBe('enterprise');
    });

    it('infers mode from suggestedProfilePatch', () => {
      const exp = makeExport([
        { summary: 'Test', patch: { mode: 'team' }, confidence: 0.95 },
      ]);
      const result = inferProfileFromEvidence([exp]);
      expect(result.suggestedMode).toBe('team');
    });

    it('infers autonomy posture from signals', () => {
      const exp = makeExport([
        { summary: 'This agent operates with strict approval workflows' },
      ]);
      const result = inferProfileFromEvidence([exp]);
      expect(result.suggestedPosture).toBe('locked_down');
    });

    it('infers data classes from content', () => {
      const exp = makeExport([
        { summary: 'Handles user PII and financial records' },
        { summary: 'Manages credentials for API access' },
      ]);
      const result = inferProfileFromEvidence([exp]);
      expect(result.suggestedDataClasses).toContain('pii');
      expect(result.suggestedDataClasses).toContain('financial');
      expect(result.suggestedDataClasses).toContain('credentials');
    });

    it('extracts jobs from action verbs', () => {
      const exp = makeExport([
        { summary: 'Manages order processing and fulfillment' },
        { summary: 'Automates report generation for the team' },
      ]);
      const result = inferProfileFromEvidence([exp]);
      expect(result.suggestedJobs.length).toBeGreaterThan(0);
    });

    it('skips exports without read consent', () => {
      const exp: MemoryEvidenceExport = {
        ...makeExport([{ summary: 'Enterprise data' }]),
        consent: { readGranted: false, writeBackGranted: false, scope: [] },
      };
      const result = inferProfileFromEvidence([exp]);
      expect(result.itemsUsed).toBe(0);
      expect(result.suggestedMode).toBeUndefined();
    });

    it('computes average confidence', () => {
      const exp = makeExport([
        { summary: 'Item 1', confidence: 0.6 },
        { summary: 'Item 2', confidence: 0.8 },
        { summary: 'Item 3', confidence: 1.0 },
      ]);
      const result = inferProfileFromEvidence([exp]);
      expect(result.confidenceAvg).toBeCloseTo(0.8, 1);
      expect(result.itemsUsed).toBe(3);
    });

    it('handles multiple exports', () => {
      const exp1 = makeExport([{ summary: 'Business operations agent' }]);
      const exp2 = makeExport([{ summary: 'Handles financial records' }]);
      const result = inferProfileFromEvidence([exp1, exp2]);
      expect(result.itemsUsed).toBe(2);
      expect(result.suggestedMode).toBe('business');
      expect(result.suggestedDataClasses).toContain('financial');
    });
  });

  describe('applyInferenceToProfile', () => {
    it('applies mode when profile has default', () => {
      const profile = createEmptyProfile('test-1');
      const inference = inferProfileFromEvidence([
        makeExport([{ summary: 'Enterprise operations' }]),
      ]);

      const updated = applyInferenceToProfile(profile, inference);
      expect(updated.mode).toBe('enterprise');
    });

    it('does not override non-default mode', () => {
      const profile = createEmptyProfile('test-2');
      profile.mode = 'team';

      const inference = inferProfileFromEvidence([
        makeExport([{ summary: 'Enterprise operations' }]),
      ]);

      const updated = applyInferenceToProfile(profile, inference);
      expect(updated.mode).toBe('team');
    });

    it('applies posture when profile has default', () => {
      const profile = createEmptyProfile('test-3');
      const inference = inferProfileFromEvidence([
        makeExport([{ summary: 'Full autonomy agent' }]),
      ]);

      const updated = applyInferenceToProfile(profile, inference);
      expect(updated.autonomy.posture).toBe('high_autonomy');
    });

    it('applies data classes when profile has none', () => {
      const profile = createEmptyProfile('test-4');
      const inference = inferProfileFromEvidence([
        makeExport([{ summary: 'Handles PII and financial data' }]),
      ]);

      const updated = applyInferenceToProfile(profile, inference);
      expect(updated.data.classes).toContain('pii');
      expect(updated.data.classes).toContain('financial');
    });

    it('does not override existing data classes', () => {
      const profile = createEmptyProfile('test-5');
      profile.data.classes = ['public'];

      const inference = inferProfileFromEvidence([
        makeExport([{ summary: 'Handles PII' }]),
      ]);

      const updated = applyInferenceToProfile(profile, inference);
      expect(updated.data.classes).toEqual(['public']);
    });

    it('applies jobs when profile has none', () => {
      const profile = createEmptyProfile('test-6');
      const inference = inferProfileFromEvidence([
        makeExport([{ summary: 'Manages order processing and customer support' }]),
      ]);

      const updated = applyInferenceToProfile(profile, inference);
      expect(updated.userContext.primaryJobs.length).toBeGreaterThan(0);
    });

    it('updates timestamp', () => {
      const profile = createEmptyProfile('test-7');
      profile.updatedAt = '2020-01-01T00:00:00.000Z';

      const inference = inferProfileFromEvidence([makeExport([{ summary: 'test' }])]);
      const updated = applyInferenceToProfile(profile, inference);
      expect(updated.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    });
  });
});
