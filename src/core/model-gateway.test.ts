import { describe, it, expect, vi } from 'vitest';
import {
  ModelGateway,
  ModelGatewayError,
  type ModelGatewayConfig,
  type ModelResponse,
  type ModelCallAuditRecord,
  type HostModelCallback,
} from './model-gateway.js';
import type { ProviderProfile } from './provider-profiles.js';
import type { ProviderPolicy } from './provider-policy.js';

function makeProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    providerId: 'anthropic/claude-4',
    modelId: 'claude-4-sonnet',
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

function makePolicy(overrides: Partial<ProviderPolicy> = {}): ProviderPolicy {
  return {
    allowedProviders: [],
    allowCrossLabFallback: false,
    sensitiveSurfaces: [],
    policyVersion: '1.0.0',
    ...overrides,
  };
}

function makeHostCallback(response?: Partial<ModelResponse>): HostModelCallback {
  return vi.fn().mockResolvedValue({
    text: 'hello',
    model: 'claude-4-sonnet',
    providerId: 'anthropic/claude-4',
    confidence: 0.95,
    latency: 100,
    ...response,
  });
}

function makeConfig(overrides: Partial<ModelGatewayConfig> = {}): ModelGatewayConfig {
  return {
    profiles: [makeProfile()],
    policy: makePolicy(),
    hostCallback: makeHostCallback(),
    ...overrides,
  };
}

describe('ModelGateway — Host mode', () => {
  it('calls host callback for host adapter profile', async () => {
    const callback = makeHostCallback();
    const gw = new ModelGateway(makeConfig({ hostCallback: callback }));

    const response = await gw.call('general', 'test prompt');

    expect(callback).toHaveBeenCalledWith('test prompt', {});
    expect(response.text).toBe('hello');
    expect(response.providerId).toBe('anthropic/claude-4');
  });

  it('passes options through to host callback', async () => {
    const callback = makeHostCallback();
    const gw = new ModelGateway(makeConfig({ hostCallback: callback }));

    await gw.call('general', 'test', { temperature: 0.5, maxTokens: 100 });

    expect(callback).toHaveBeenCalledWith('test', { temperature: 0.5, maxTokens: 100 });
  });

  it('throws if no host callback configured', async () => {
    const gw = new ModelGateway(makeConfig({ hostCallback: undefined }));

    await expect(gw.call('general', 'test')).rejects.toThrow(ModelGatewayError);
    await expect(gw.call('general', 'test')).rejects.toThrow('hostCallback');
  });
});

describe('ModelGateway — Disabled mode', () => {
  it('throws error for disabled adapter', async () => {
    const profile = makeProfile({ adapter: 'disabled' });
    // Need a non-disabled profile for purpose selection to work...
    // Actually disabled profiles are skipped in selection, so we need to test
    // when ALL profiles are disabled
    const gw = new ModelGateway(makeConfig({ profiles: [profile] }));

    await expect(gw.call('general', 'test')).rejects.toThrow(ModelGatewayError);
  });

  it('returns NO_PROFILE error when only disabled profiles exist', async () => {
    const profile = makeProfile({ adapter: 'disabled' });
    const gw = new ModelGateway(makeConfig({ profiles: [profile] }));

    try {
      await gw.call('general', 'test');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ModelGatewayError);
      expect((err as ModelGatewayError).code).toBe('NO_PROFILE');
    }
  });
});

describe('ModelGateway — Direct mode', () => {
  it('calls HTTP adapter with API key from env', async () => {
    process.env['TEST_API_KEY'] = 'sk-test-123';
    const httpAdapter = vi.fn().mockResolvedValue({
      text: 'response',
      model: 'gpt-5',
      providerId: 'openai/gpt-5',
      confidence: 0.9,
      latency: 200,
    });

    const profile = makeProfile({
      providerId: 'openai/gpt-5',
      adapter: 'direct',
      credentialSource: 'env-var',
      envVarName: 'TEST_API_KEY',
      endpoint: 'https://api.openai.com/v1',
    });

    const gw = new ModelGateway(
      makeConfig({ profiles: [profile], httpAdapter, hostCallback: undefined }),
    );

    const response = await gw.call('general', 'test');

    expect(httpAdapter).toHaveBeenCalledWith(
      'https://api.openai.com/v1',
      'sk-test-123',
      'test',
      {},
      profile,
    );
    expect(response.text).toBe('response');

    delete process.env['TEST_API_KEY'];
  });

  it('throws MISSING_CREDENTIAL when env var not set', async () => {
    delete process.env['MISSING_KEY'];

    const profile = makeProfile({
      adapter: 'direct',
      credentialSource: 'env-var',
      envVarName: 'MISSING_KEY',
    });

    const gw = new ModelGateway(
      makeConfig({ profiles: [profile], httpAdapter: vi.fn(), hostCallback: undefined }),
    );

    try {
      await gw.call('general', 'test');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ModelGatewayError);
      expect((err as ModelGatewayError).code).toBe('MISSING_CREDENTIAL');
    }
  });
});

describe('ModelGateway — Policy enforcement', () => {
  it('blocks non-allowed providers', async () => {
    const policy = makePolicy({ allowedProviders: ['openai/gpt-5'] });
    const profile = makeProfile({ providerId: 'anthropic/claude-4' });

    const gw = new ModelGateway(makeConfig({ profiles: [profile], policy }));

    try {
      await gw.call('general', 'test');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ModelGatewayError);
      expect((err as ModelGatewayError).code).toBe('POLICY_BLOCKED');
    }
  });

  it('blocks cross-lab fallback', async () => {
    const policy = makePolicy({ allowCrossLabFallback: false });
    const profile = makeProfile({ providerId: 'openai/gpt-5' });

    const gw = new ModelGateway(
      makeConfig({ profiles: [profile], policy, currentLab: 'anthropic' }),
    );

    try {
      await gw.call('general', 'test');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ModelGatewayError);
      expect((err as ModelGatewayError).code).toBe('POLICY_BLOCKED');
    }
  });

  it('allows cross-lab when explicitly permitted', async () => {
    const policy = makePolicy({ allowCrossLabFallback: true });
    const callback = makeHostCallback();
    const profile = makeProfile({ providerId: 'openai/gpt-5' });

    const gw = new ModelGateway(
      makeConfig({ profiles: [profile], policy, currentLab: 'anthropic', hostCallback: callback }),
    );

    const response = await gw.call('general', 'test');
    expect(response.text).toBe('hello');
  });

  it('enforces sensitive surface override (disabled)', async () => {
    const policy = makePolicy({
      sensitiveSurfaces: [
        { surfaceId: 'finance', mode: 'disabled', reason: 'No models for finance' },
      ],
    });

    const gw = new ModelGateway(makeConfig({ policy }));

    try {
      await gw.call('general', 'test', { surfaceId: 'finance' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ModelGatewayError);
      expect((err as ModelGatewayError).code).toBe('POLICY_BLOCKED');
    }
  });
});

describe('ModelGateway — Audit logging', () => {
  it('records audit for successful call', async () => {
    const auditRecords: ModelCallAuditRecord[] = [];
    const gw = new ModelGateway(makeConfig({ onAudit: (r) => auditRecords.push(r) }));

    await gw.call('general', 'test prompt');

    expect(auditRecords).toHaveLength(1);
    expect(auditRecords[0].providerId).toBe('anthropic/claude-4');
    expect(auditRecords[0].purpose).toBe('general');
    expect(auditRecords[0].success).toBe(true);
    expect(auditRecords[0].promptHash).toBeTruthy();
    expect(auditRecords[0].outputHash).toBeTruthy();
    expect(auditRecords[0].policyVersion).toBe('1.0.0');
  });

  it('records audit for failed call', async () => {
    const auditRecords: ModelCallAuditRecord[] = [];
    const failCallback = vi.fn().mockRejectedValue(new Error('API error'));
    const profile = makeProfile({ fallbackGroup: undefined });

    const gw = new ModelGateway(
      makeConfig({
        profiles: [profile],
        hostCallback: failCallback,
        onAudit: (r) => auditRecords.push(r),
      }),
    );

    await expect(gw.call('general', 'test')).rejects.toThrow('API error');

    expect(auditRecords).toHaveLength(1);
    expect(auditRecords[0].success).toBe(false);
    expect(auditRecords[0].error).toContain('API error');
  });

  it('audit log accessible via getAuditLog()', async () => {
    const gw = new ModelGateway(makeConfig());
    await gw.call('general', 'test');

    const log = gw.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].modelId).toBe('claude-4-sonnet');
  });
});

describe('ModelGateway — Timeout', () => {
  it('times out slow providers', async () => {
    const slowCallback: HostModelCallback = () =>
      new Promise((resolve) => setTimeout(() => resolve({
        text: 'late',
        model: 'slow',
        providerId: 'slow',
        confidence: 1,
        latency: 5000,
      }), 5000));

    const profile = makeProfile({ timeoutMs: 50, fallbackGroup: undefined });
    const gw = new ModelGateway(makeConfig({ profiles: [profile], hostCallback: slowCallback }));

    try {
      await gw.call('general', 'test');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ModelGatewayError);
      expect((err as ModelGatewayError).code).toBe('TIMEOUT');
    }
  });
});

describe('ModelGateway — Fallback', () => {
  it('falls back to alternate profile on error', async () => {
    const failCallback = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({
        text: 'fallback response',
        model: 'backup',
        providerId: 'anthropic/backup',
        confidence: 0.8,
        latency: 150,
      });

    const profiles: ProviderProfile[] = [
      makeProfile({ providerId: 'anthropic/primary', fallbackGroup: 'tier1' }),
      makeProfile({ providerId: 'anthropic/backup', fallbackGroup: 'tier1' }),
    ];

    const gw = new ModelGateway(makeConfig({ profiles, hostCallback: failCallback }));

    const response = await gw.call('general', 'test');
    expect(response.text).toBe('fallback response');
  });
});
