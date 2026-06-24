import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  generateWriteBackSummary,
  executeWriteBack,
  formatWriteBackMarkdown,
  writeOnboardingSummary,
} from './memory-writeback.js';
import { createEmptyProfile } from '../contracts/onboarding-profile.contracts.js';

describe('writeOnboardingSummary (C3 — real local write-back)', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('writes the redacted summary to a local file when consent is granted', () => {
    dir = mkdtempSync(join(tmpdir(), 'dc-wb-'));
    const profile = createEmptyProfile('wb-local');
    profile.mode = 'business';
    profile.memory.sources = [
      { kind: 'markdown-vault', detected: true, detectionSignals: [], readConsent: true, writeBackConsent: true, scope: [] },
    ];
    const result = writeOnboardingSummary(profile, dir);
    expect(result.skipped).toBe(false);
    expect(result.success).toBe(true);
    const path = join(dir, 'onboarding-summary.md');
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf-8')).toContain('Decision Core Setup Summary');
  });

  it('skips cleanly (writes nothing) without write-back consent', () => {
    dir = mkdtempSync(join(tmpdir(), 'dc-wb-'));
    const result = writeOnboardingSummary(createEmptyProfile('wb-noconsent'), dir);
    expect(result.skipped).toBe(true);
    expect(existsSync(join(dir, 'onboarding-summary.md'))).toBe(false);
  });
});

describe('memory-writeback', () => {
  describe('generateWriteBackSummary', () => {
    it('generates summary from profile', () => {
      const profile = createEmptyProfile('wb-1');
      profile.agent.harness = 'openclaw';
      profile.mode = 'business';
      profile.policies = [
        { path: 'policies/000-baseline.md', category: 'baseline', generatedAt: '2026-01-01T00:00:00.000Z' },
      ];

      const summary = generateWriteBackSummary(profile);
      expect(summary.profileId).toBe('wb-1');
      expect(summary.harness).toBe('openclaw');
      expect(summary.mode).toBe('business');
      expect(summary.generatedPolicies).toHaveLength(1);
      expect(summary.activationStatus).toBe('pending');
    });

    it('shows activated status', () => {
      const profile = createEmptyProfile('wb-2');
      profile.activatedAt = '2026-01-01T00:00:00.000Z';
      const summary = generateWriteBackSummary(profile);
      expect(summary.activationStatus).toBe('activated');
    });
  });

  describe('executeWriteBack', () => {
    it('returns skipped when no write consent', () => {
      const profile = createEmptyProfile('wb-3');
      const results = executeWriteBack(profile);
      expect(results).toHaveLength(1);
      expect(results[0].skipped).toBe(true);
      expect(results[0].reason).toContain('No write-back consent');
    });

    it('returns result for each consented source', () => {
      const profile = createEmptyProfile('wb-4');
      profile.memory.sources = [
        { kind: 'gbrain', detected: true, detectionSignals: [], readConsent: true, writeBackConsent: true, scope: [] },
        { kind: 'openclaw-native', detected: true, detectionSignals: [], readConsent: true, writeBackConsent: true, scope: [] },
        { kind: 'mem0', detected: true, detectionSignals: [], readConsent: true, writeBackConsent: false, scope: [] },
      ];

      const results = executeWriteBack(profile);
      expect(results).toHaveLength(2);
      expect(results[0].sourceKind).toBe('gbrain');
      expect(results[1].sourceKind).toBe('openclaw-native');
    });

    it('does not write without consent', () => {
      const profile = createEmptyProfile('wb-5');
      profile.memory.sources = [
        { kind: 'gbrain', detected: true, detectionSignals: [], readConsent: true, writeBackConsent: false, scope: [] },
      ];

      const results = executeWriteBack(profile);
      expect(results).toHaveLength(1);
      expect(results[0].skipped).toBe(true);
    });
  });

  describe('formatWriteBackMarkdown', () => {
    it('produces valid markdown', () => {
      const summary = generateWriteBackSummary(createEmptyProfile('wb-6'));
      const md = formatWriteBackMarkdown(summary);
      expect(md).toContain('# Decision Core Setup Summary');
      expect(md).toContain('wb-6');
    });
  });
});
