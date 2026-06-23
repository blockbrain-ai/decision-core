import { describe, it, expect } from 'vitest';
import { getAuthorisedBrains, canAccess, getAccessMatrix, verifyMounts } from './access-policy-loader.js';
import type { AccessPolicyConfig } from './access-policy.contracts.js';

const policy: AccessPolicyConfig = {
  version: '1.0',
  classifications: [
    { name: 'public', brain: 'company-public', accessibleBy: ['ceo', 'finance', 'ops'], writeAccess: ['ceo'], neverAccessibleBy: [], description: '', examples: [] },
    { name: 'financial', brain: 'company-financial', accessibleBy: ['ceo', 'finance'], writeAccess: ['finance'], neverAccessibleBy: ['ops', 'product'], description: '', examples: [] },
    { name: 'hr', brain: 'company-hr', accessibleBy: ['ceo'], writeAccess: ['ceo'], neverAccessibleBy: ['finance', 'ops', 'product'], description: '', examples: [] },
    { name: 'command-center', brain: 'command-center', accessibleBy: ['ceo'], writeAccess: [], neverAccessibleBy: ['finance', 'ops', 'product'], description: '', examples: [] },
  ],
};

describe('access-policy-loader', () => {
  describe('getAuthorisedBrains', () => {
    it('CEO gets all brains', () => {
      const brains = getAuthorisedBrains(policy, 'ceo');
      expect(brains).toContain('company-public');
      expect(brains).toContain('company-financial');
      expect(brains).toContain('company-hr');
      expect(brains).toContain('command-center');
    });

    it('finance gets public + financial only', () => {
      const brains = getAuthorisedBrains(policy, 'finance');
      expect(brains).toContain('company-public');
      expect(brains).toContain('company-financial');
      expect(brains).not.toContain('company-hr');
      expect(brains).not.toContain('command-center');
    });

    it('ops gets public only — neverAccessibleBy blocks financial', () => {
      const brains = getAuthorisedBrains(policy, 'ops');
      expect(brains).toContain('company-public');
      expect(brains).not.toContain('company-financial');
      expect(brains).not.toContain('company-hr');
    });

    it('unknown role gets nothing', () => {
      const brains = getAuthorisedBrains(policy, 'unknown-role');
      expect(brains).toHaveLength(0);
    });
  });

  describe('canAccess', () => {
    it('CEO can access hr', () => {
      expect(canAccess(policy, 'ceo', 'hr')).toBe(true);
    });

    it('finance cannot access hr', () => {
      expect(canAccess(policy, 'finance', 'hr')).toBe(false);
    });

    it('returns false for unknown classification', () => {
      expect(canAccess(policy, 'ceo', 'nonexistent')).toBe(false);
    });
  });

  describe('getAccessMatrix', () => {
    it('builds a complete role→brains matrix', () => {
      const matrix = getAccessMatrix(policy);
      expect(matrix.get('ceo')).toContain('company-hr');
      expect(matrix.get('finance')).not.toContain('company-hr');
      expect(matrix.get('ops')).not.toContain('company-financial');
    });
  });

  describe('verifyMounts', () => {
    it('detects no violations for correct mounts', () => {
      const violations = verifyMounts(policy, [
        { agentId: 'finance-agent', roles: ['finance'], mountedBrains: ['company-public', 'company-financial'] },
      ]);
      expect(violations).toHaveLength(0);
    });

    it('detects violation when finance mounts company-hr', () => {
      const violations = verifyMounts(policy, [
        { agentId: 'finance-agent', roles: ['finance'], mountedBrains: ['company-hr'] },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0].agentId).toBe('finance-agent');
      expect(violations[0].brain).toBe('company-hr');
      expect(violations[0].reason).toContain('neverAccessibleBy');
    });

    it('detects violation when ops mounts command-center', () => {
      const violations = verifyMounts(policy, [
        { agentId: 'ops-agent', roles: ['ops'], mountedBrains: ['command-center'] },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0].brain).toBe('command-center');
    });
  });
});
