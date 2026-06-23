/**
 * Provider Profile Credential Validation Tests
 */

import { describe, it, expect, afterEach } from 'vitest';
import { validateProfileCredentials, validateAllProfileCredentials } from './credential-validation.js';
import type { ProviderProfile } from './provider-profiles.js';

function makeProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    providerId: 'test-provider',
    modelId: 'test-model',
    adapter: 'direct',
    purposes: ['general'],
    capabilities: ['structured-output'],
    dataBoundary: 'local',
    credentialSource: 'env-var',
    envVarName: 'TEST_API_KEY',
    timeoutMs: 30000,
    maxRetries: 1,
    ...overrides,
  };
}

describe('validateProfileCredentials', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it('valid when env var is set', () => {
    process.env['TEST_API_KEY'] = 'some-value';
    const result = validateProfileCredentials(makeProfile());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('invalid when env var is not set', () => {
    delete process.env['TEST_API_KEY'];
    const result = validateProfileCredentials(makeProfile());
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('TEST_API_KEY');
    expect(result.errors[0]).toContain('not set');
  });

  it('invalid when env-var source but no envVarName', () => {
    const result = validateProfileCredentials(makeProfile({ envVarName: undefined }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('envVarName is not specified'));
  });

  it('invalid when direct adapter lacks envVarName', () => {
    const result = validateProfileCredentials(makeProfile({
      adapter: 'direct',
      credentialSource: 'none',
      envVarName: undefined,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Direct adapter requires envVarName'));
  });

  it('invalid when host adapter uses non-host-callback credential source', () => {
    const result = validateProfileCredentials(makeProfile({
      adapter: 'host',
      credentialSource: 'env-var',
      envVarName: 'SOME_KEY',
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('host-callback'));
  });

  it('valid for host adapter with host-callback credential source', () => {
    const result = validateProfileCredentials(makeProfile({
      adapter: 'host',
      credentialSource: 'host-callback',
      envVarName: undefined,
    }));
    expect(result.valid).toBe(true);
  });

  it('valid for disabled adapter with none credential source', () => {
    const result = validateProfileCredentials(makeProfile({
      adapter: 'disabled',
      credentialSource: 'none',
      envVarName: undefined,
    }));
    expect(result.valid).toBe(true);
  });

  it('never includes credential values in results', () => {
    process.env['TEST_API_KEY'] = 'super-secret-value';
    const result = validateProfileCredentials(makeProfile());
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain('super-secret-value');
  });
});

describe('validateAllProfileCredentials', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it('validates multiple profiles', () => {
    process.env['KEY_A'] = 'set';
    delete process.env['KEY_B'];

    const profiles = [
      makeProfile({ providerId: 'p1', envVarName: 'KEY_A' }),
      makeProfile({ providerId: 'p2', envVarName: 'KEY_B' }),
    ];

    const results = validateAllProfileCredentials(profiles);
    expect(results).toHaveLength(2);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
  });

  it('returns empty array for empty profiles', () => {
    const results = validateAllProfileCredentials([]);
    expect(results).toHaveLength(0);
  });
});
