import { describe, it, expect } from 'vitest';
import {
  getProviderCapability,
  getProvidersByTier,
  getAllProviderCapabilities,
  createExportTemplate,
  isCredentialFreeSource,
} from './provider-export-source.js';
import { MemoryEvidenceExportSchema } from './memory-evidence.contracts.js';

describe('provider-export-source', () => {
  describe('getProviderCapability', () => {
    it('returns capability for gbrain', () => {
      const cap = getProviderCapability('gbrain');
      expect(cap).not.toBeNull();
      expect(cap!.tier).toBe(0);
      expect(cap!.supportsDirectRead).toBe(true);
      expect(cap!.requiresCredential).toBe(false);
    });

    it('returns capability for mem0', () => {
      const cap = getProviderCapability('mem0');
      expect(cap).not.toBeNull();
      expect(cap!.tier).toBe(1);
      expect(cap!.requiresCredential).toBe(true);
    });

    it('returns null for unknown kind', () => {
      expect(getProviderCapability('none')).toBeNull();
    });
  });

  describe('getProvidersByTier', () => {
    it('returns tier 0 providers', () => {
      const tier0 = getProvidersByTier(0);
      expect(tier0.length).toBeGreaterThanOrEqual(6);
      expect(tier0.every((p) => p.tier === 0)).toBe(true);
    });

    it('returns tier 1 providers', () => {
      const tier1 = getProvidersByTier(1);
      expect(tier1.length).toBe(3);
      expect(tier1.every((p) => p.tier === 1)).toBe(true);
    });

    it('returns tier 2 providers', () => {
      const tier2 = getProvidersByTier(2);
      expect(tier2.length).toBeGreaterThanOrEqual(3);
      expect(tier2.every((p) => p.tier === 2)).toBe(true);
    });
  });

  describe('getAllProviderCapabilities', () => {
    it('returns all known providers', () => {
      const all = getAllProviderCapabilities();
      expect(all.length).toBeGreaterThanOrEqual(12);
    });

    it('returns a copy', () => {
      const a = getAllProviderCapabilities();
      const b = getAllProviderCapabilities();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe('createExportTemplate', () => {
    it('creates a valid empty export', () => {
      const template = createExportTemplate('my-source', 'gbrain');
      expect(template.schemaVersion).toBe(1);
      expect(template.sourceId).toBe('my-source');
      expect(template.sourceKind).toBe('gbrain');
      expect(template.collectedBy).toBe('user-agent');
      expect(template.consent.readGranted).toBe(false);
      expect(template.items).toEqual([]);

      const result = MemoryEvidenceExportSchema.safeParse(template);
      expect(result.success).toBe(true);
    });
  });

  describe('isCredentialFreeSource', () => {
    it('returns true for tier 0 sources', () => {
      expect(isCredentialFreeSource('gbrain')).toBe(true);
      expect(isCredentialFreeSource('openclaw-native')).toBe(true);
      expect(isCredentialFreeSource('hermes-built-in')).toBe(true);
      expect(isCredentialFreeSource('markdown-vault')).toBe(true);
    });

    it('returns false for tier 1 sources', () => {
      expect(isCredentialFreeSource('mem0')).toBe(false);
      expect(isCredentialFreeSource('honcho')).toBe(false);
      expect(isCredentialFreeSource('zep-graphiti')).toBe(false);
    });

    it('returns false for unknown source', () => {
      expect(isCredentialFreeSource('none')).toBe(false);
    });
  });
});
