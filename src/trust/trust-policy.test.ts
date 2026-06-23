import { describe, it, expect } from 'vitest';
import { TrustPolicyLoader } from './trust-policy.js';
import trustPolicyJson from '../../config/trust-suite/trust-policy.json';
import surfaceBindingsJson from '../../config/trust-suite/surface-bindings.json';
import surfaceRegistryJson from '../../config/trust-suite/surface-registry.json';

describe('TrustPolicyLoader', () => {
  describe('loadPolicy', () => {
    it('loads and validates trust-policy.json', () => {
      const loader = new TrustPolicyLoader();
      const result = loader.loadPolicy(trustPolicyJson);

      expect(result.version).toBe('1.0.0');
      expect(result.policies.length).toBeGreaterThan(0);
    });

    it('indexes policies by surfaceId', () => {
      const loader = new TrustPolicyLoader();
      loader.loadPolicy(trustPolicyJson);

      const entry = loader.getPolicyEntry('finance.processing');
      expect(entry).not.toBeNull();
      expect(entry!.riskTier).toBe('critical');
      expect(entry!.reviewMode).toBe('always');
    });

    it('returns null for unknown surface', () => {
      const loader = new TrustPolicyLoader();
      loader.loadPolicy(trustPolicyJson);

      expect(loader.getPolicyEntry('unknown.surface')).toBeNull();
    });

    it('rejects invalid policy data', () => {
      const loader = new TrustPolicyLoader();
      expect(() => loader.loadPolicy({ version: '1.0.0', policies: [{ invalid: true }] })).toThrow();
    });

    it('rejects completely invalid input', () => {
      const loader = new TrustPolicyLoader();
      expect(() => loader.loadPolicy('not an object')).toThrow();
    });
  });

  describe('loadBindings', () => {
    it('loads and validates surface-bindings.json', () => {
      const loader = new TrustPolicyLoader();
      const result = loader.loadBindings(surfaceBindingsJson);

      expect(result.version).toBe('1.0.0');
      expect(result.bindings.length).toBeGreaterThan(0);
    });

    it('indexes bindings by surfaceId', () => {
      const loader = new TrustPolicyLoader();
      loader.loadBindings(surfaceBindingsJson);

      const binding = loader.getBinding('finance.processing');
      expect(binding).not.toBeNull();
      expect(binding!.pattern).toBe('tribunal');
      expect(binding!.fallbackStrategy).toBe('safe_block');
    });

    it('returns null for unknown surface binding', () => {
      const loader = new TrustPolicyLoader();
      loader.loadBindings(surfaceBindingsJson);

      expect(loader.getBinding('unknown.surface')).toBeNull();
    });
  });

  describe('loadRegistry', () => {
    it('loads and validates surface-registry.json', () => {
      const loader = new TrustPolicyLoader();
      const result = loader.loadRegistry(surfaceRegistryJson);

      expect(result.version).toBe('1.0.0');
      expect(result.surfaces.length).toBeGreaterThan(0);
    });

    it('indexes registry entries by surfaceId', () => {
      const loader = new TrustPolicyLoader();
      loader.loadRegistry(surfaceRegistryJson);

      const entry = loader.getRegistryEntry('compliance.screening');
      expect(entry).not.toBeNull();
      expect(entry!.category).toBe('compliance');
      expect(entry!.riskTier).toBe('critical');
    });
  });

  describe('isLoaded', () => {
    it('returns false when nothing is loaded', () => {
      const loader = new TrustPolicyLoader();
      expect(loader.isLoaded()).toBe(false);
    });

    it('returns false when only policy is loaded', () => {
      const loader = new TrustPolicyLoader();
      loader.loadPolicy(trustPolicyJson);
      expect(loader.isLoaded()).toBe(false);
    });

    it('returns true when both policy and bindings are loaded', () => {
      const loader = new TrustPolicyLoader();
      loader.loadPolicy(trustPolicyJson);
      loader.loadBindings(surfaceBindingsJson);
      expect(loader.isLoaded()).toBe(true);
    });
  });
});
