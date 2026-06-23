import { describe, it, expect } from 'vitest';
import { EnterpriseRouteConfigLoader } from './config-loader.js';
import { hashCanonicalJson } from '../../utils/audit-hash.js';
import type { RuntimeRouteConfig } from '../types/runtime-config.js';

function makeValidConfig(): RuntimeRouteConfig {
  const surfaces = [
    {
      surfaceId: 'test.surface',
      routeClass: 'deterministic_first_a5_on_uncertain' as const,
      deterministicExtractorId: null,
      confidenceThreshold: 0.9,
      fallbackPattern: 'a5_hybrid',
      frontierShadow: false,
      humanReviewOnDisagreement: false,
      policyEvidenceRequired: true,
      scoreSummary: { weightedTotal: 0.85, hardBlockerCount: 0 },
    },
  ];

  const configHash = hashCanonicalJson({
    version: '1.0.0',
    enterpriseId: 'test-enterprise',
    optimizerVersion: '0.1.0',
    surfaces,
  });

  return {
    version: '1.0.0',
    generatedAt: '2026-05-02T00:00:00.000Z',
    enterpriseId: 'test-enterprise',
    configHash,
    optimizerVersion: '0.1.0',
    surfaces,
  };
}

describe('EnterpriseRouteConfigLoader', () => {
  it('starts unloaded', () => {
    const loader = new EnterpriseRouteConfigLoader();
    expect(loader.isLoaded()).toBe(false);
    expect(loader.getConfig()).toBeNull();
  });

  it('loads valid config from JSON', () => {
    const loader = new EnterpriseRouteConfigLoader();
    const config = makeValidConfig();
    loader.loadFromJson(JSON.stringify(config));

    expect(loader.isLoaded()).toBe(true);
    expect(loader.getConfig()?.version).toBe('1.0.0');
  });

  it('loads valid config from object', () => {
    const loader = new EnterpriseRouteConfigLoader();
    const config = makeValidConfig();
    loader.loadFromObject(config);

    expect(loader.isLoaded()).toBe(true);
    expect(loader.getConfig()?.enterpriseId).toBe('test-enterprise');
  });

  it('resolves surface route', () => {
    const loader = new EnterpriseRouteConfigLoader();
    loader.loadFromObject(makeValidConfig());

    const route = loader.resolveSurfaceRoute('test.surface');
    expect(route).not.toBeNull();
    expect(route!.routeClass).toBe('deterministic_first_a5_on_uncertain');
    expect(route!.confidenceThreshold).toBe(0.9);
  });

  it('returns null for unknown surface', () => {
    const loader = new EnterpriseRouteConfigLoader();
    loader.loadFromObject(makeValidConfig());
    expect(loader.resolveSurfaceRoute('unknown.surface')).toBeNull();
  });

  it('rejects invalid JSON', () => {
    const loader = new EnterpriseRouteConfigLoader();
    expect(() => loader.loadFromJson('not json')).toThrow('not valid JSON');
  });

  it('rejects config with wrong schema', () => {
    const loader = new EnterpriseRouteConfigLoader();
    expect(() => loader.loadFromJson(JSON.stringify({ invalid: true }))).toThrow('validation failed');
  });

  it('rejects config with wrong hash', () => {
    const loader = new EnterpriseRouteConfigLoader();
    const config = makeValidConfig();
    config.configHash = 'wrong-hash';
    expect(() => loader.loadFromJson(JSON.stringify(config))).toThrow('configHash mismatch');
  });

  it('rejects config with duplicate surface IDs', () => {
    const loader = new EnterpriseRouteConfigLoader();
    const config = makeValidConfig();
    config.surfaces.push({ ...config.surfaces[0] });
    // Recompute hash to pass schema check but fail on duplicate
    config.configHash = hashCanonicalJson({
      version: config.version,
      enterpriseId: config.enterpriseId,
      optimizerVersion: config.optimizerVersion,
      surfaces: config.surfaces,
    });
    expect(() => loader.loadFromObject(config)).toThrow('duplicate surfaceId');
  });
});
