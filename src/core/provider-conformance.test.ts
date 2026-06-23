import { describe, it, expect, vi } from 'vitest';
import { runConformanceTests } from './provider-conformance.js';
import type { ModelGatewayConfig } from './model-gateway.js';
import type { ProviderProfile } from './provider-profiles.js';

function makeProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    providerId: 'test/model-1',
    modelId: 'model-1',
    adapter: 'host',
    purposes: ['general'],
    capabilities: ['structured-output'],
    dataBoundary: 'global',
    credentialSource: 'host-callback',
    timeoutMs: 30000,
    maxRetries: 1,
    ...overrides,
  };
}

describe('runConformanceTests', () => {
  it('returns "usable" when all tests pass', async () => {
    const profile = makeProfile();
    const config: ModelGatewayConfig = {
      profiles: [profile],
      policy: { allowedProviders: [], allowCrossLabFallback: false, sensitiveSurfaces: [], policyVersion: '1.0' },
      hostCallback: vi.fn().mockResolvedValue({
        text: '{"status": "ok", "value": 42}',
        model: 'model-1',
        providerId: 'test/model-1',
        confidence: 0.95,
        latency: 50,
      }),
    };

    const report = await runConformanceTests(profile, config);

    expect(report.verdict).toBe('usable');
    expect(report.providerId).toBe('test/model-1');
    expect(report.tests.every(t => t.passed)).toBe(true);
  });

  it('returns "limited" when some tests fail', async () => {
    const profile = makeProfile();
    let callCount = 0;
    const config: ModelGatewayConfig = {
      profiles: [profile],
      policy: { allowedProviders: [], allowCrossLabFallback: false, sensitiveSurfaces: [], policyVersion: '1.0' },
      hostCallback: vi.fn().mockImplementation(() => {
        callCount++;
        // First call (basic response) succeeds
        if (callCount === 1) {
          return Promise.resolve({
            text: 'hello',
            model: 'model-1',
            providerId: 'test/model-1',
            confidence: 0.9,
            latency: 50,
          });
        }
        // Second call (structured output) returns invalid JSON
        if (callCount === 2) {
          return Promise.resolve({
            text: 'not json at all',
            model: 'model-1',
            providerId: 'test/model-1',
            confidence: 0.9,
            latency: 50,
          });
        }
        // Third call (timeout test) resolves quickly
        return Promise.resolve({
          text: 'ok',
          model: 'model-1',
          providerId: 'test/model-1',
          confidence: 0.9,
          latency: 10,
        });
      }),
    };

    const report = await runConformanceTests(profile, config);

    // basic-response passes, structured-output fails, timeout passes, error-handling passes
    expect(report.verdict).toBe('limited');
    const structured = report.tests.find(t => t.testName === 'structured-output');
    expect(structured?.passed).toBe(false);
  });

  it('returns "not-usable" when most tests fail', async () => {
    const profile = makeProfile();
    const config: ModelGatewayConfig = {
      profiles: [profile],
      policy: { allowedProviders: [], allowCrossLabFallback: false, sensitiveSurfaces: [], policyVersion: '1.0' },
      hostCallback: vi.fn().mockRejectedValue(new Error('Provider down')),
    };

    const report = await runConformanceTests(profile, config);

    // basic-response fails, structured-output fails, timeout fails (error not TIMEOUT),
    // error-handling passes (tests disabled mode which doesn't call callback)
    expect(report.verdict).toBe('not-usable');
  });

  it('includes timestamp in report', async () => {
    const profile = makeProfile();
    const config: ModelGatewayConfig = {
      profiles: [profile],
      policy: { allowedProviders: [], allowCrossLabFallback: false, sensitiveSurfaces: [], policyVersion: '1.0' },
      hostCallback: vi.fn().mockResolvedValue({
        text: '{"ok": true}',
        model: 'model-1',
        providerId: 'test/model-1',
        confidence: 0.9,
        latency: 50,
      }),
    };

    const report = await runConformanceTests(profile, config);
    expect(report.timestamp).toBeTruthy();
    expect(new Date(report.timestamp).getTime()).not.toBeNaN();
  });
});
