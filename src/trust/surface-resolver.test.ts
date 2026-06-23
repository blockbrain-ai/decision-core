import { describe, it, expect, vi } from 'vitest';
import { SurfaceResolver } from './surface-resolver.js';
import { TrustPolicyLoader } from './trust-policy.js';
import type { ModelGatewayAdapter } from '../adapters/model-gateway.js';
import surfaceBindingsJson from '../../config/trust-suite/surface-bindings.json';

function makeGateway(): ModelGatewayAdapter {
  return {
    evaluate: vi.fn().mockResolvedValue({
      text: 'resolved output',
      model: 'test-model',
      confidence: 0.9,
      latency: 100,
    }),
  };
}

describe('SurfaceResolver', () => {
  function setup() {
    const loader = new TrustPolicyLoader();
    loader.loadBindings(surfaceBindingsJson);
    return new SurfaceResolver(loader);
  }

  describe('resolve', () => {
    it('resolves a known surface and executes its pattern', async () => {
      const resolver = setup();
      const gateway = makeGateway();

      const result = await resolver.resolve(
        'communication.notification',
        { prompt: 'Send notification', tenantId: 'tenant-1', correlationId: 'corr-1' },
        { gateway },
      );

      expect(result.patternUsed).toBe('single_model');
      expect(result.output).toBe('resolved output');
      expect(result.autonomyStatus).toBe('verified_autonomous');
    });

    it('fails closed for unknown surface', async () => {
      const resolver = setup();
      const gateway = makeGateway();

      const result = await resolver.resolve(
        'unknown.surface',
        { prompt: 'test', tenantId: 'tenant-1', correlationId: 'corr-1' },
        { gateway },
      );

      expect(result.autonomyStatus).toBe('safe_block');
      expect(result.reason).toBe('surface_binding_not_found');
      expect(result.output).toBeNull();
    });

    it('fails closed when gateway not provided for model-dependent surface', async () => {
      const resolver = setup();

      const result = await resolver.resolve(
        'finance.processing',
        { prompt: 'Process payment', tenantId: 'tenant-1', correlationId: 'corr-1' },
      );

      expect(result.autonomyStatus).toBe('safe_block');
      expect(result.reason).toBe('model_gateway_unavailable');
      expect(result.output).toBeNull();
    });
  });

  describe('hasBinding', () => {
    it('returns true for known surface', () => {
      const resolver = setup();
      expect(resolver.hasBinding('finance.processing')).toBe(true);
    });

    it('returns false for unknown surface', () => {
      const resolver = setup();
      expect(resolver.hasBinding('unknown.surface')).toBe(false);
    });
  });

  describe('getPatternType', () => {
    it('returns pattern type for known surface', () => {
      const resolver = setup();
      expect(resolver.getPatternType('finance.processing')).toBe('tribunal');
      expect(resolver.getPatternType('communication.notification')).toBe('single_model');
      expect(resolver.getPatternType('data.classification')).toBe('a5_hybrid');
    });

    it('returns null for unknown surface', () => {
      const resolver = setup();
      expect(resolver.getPatternType('unknown.surface')).toBeNull();
    });
  });
});
