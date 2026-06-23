import { describe, it, expect } from 'vitest';
import {
  ProviderPolicySchema,
  enforceProviderPolicy,
  filterAllowedProfiles,
  extractLab,
  getSurfaceMode,
  type ProviderPolicy,
} from './provider-policy.js';
import type { ProviderProfile } from './provider-profiles.js';

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

describe('ProviderPolicySchema', () => {
  it('validates a correct policy', () => {
    const result = ProviderPolicySchema.safeParse({
      allowedProviders: ['anthropic/claude-4'],
      allowCrossLabFallback: false,
      policyVersion: '1.0.0',
    });
    expect(result.success).toBe(true);
  });

  it('defaults allowCrossLabFallback to false', () => {
    const result = ProviderPolicySchema.parse({
      allowedProviders: [],
      policyVersion: '1.0.0',
    });
    expect(result.allowCrossLabFallback).toBe(false);
  });

  it('rejects missing policyVersion', () => {
    const result = ProviderPolicySchema.safeParse({
      allowedProviders: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('extractLab', () => {
  it('extracts lab from "lab/model" format', () => {
    expect(extractLab('anthropic/claude-4')).toBe('anthropic');
  });

  it('returns full string if no slash', () => {
    expect(extractLab('localmodel')).toBe('localmodel');
  });
});

describe('enforceProviderPolicy', () => {
  it('allows provider when allowlist is empty', () => {
    const result = enforceProviderPolicy(makePolicy(), makeProfile());
    expect(result.allowed).toBe(true);
  });

  it('allows provider in allowlist', () => {
    const policy = makePolicy({ allowedProviders: ['anthropic/claude-4'] });
    const result = enforceProviderPolicy(policy, makeProfile());
    expect(result.allowed).toBe(true);
  });

  it('blocks provider not in allowlist', () => {
    const policy = makePolicy({ allowedProviders: ['openai/gpt-5'] });
    const result = enforceProviderPolicy(policy, makeProfile());
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not in allowlist');
  });

  it('blocks cross-lab fallback when not allowed', () => {
    const policy = makePolicy({ allowCrossLabFallback: false });
    const profile = makeProfile({ providerId: 'openai/gpt-5' });
    const result = enforceProviderPolicy(policy, profile, undefined, 'anthropic');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Cross-lab fallback');
  });

  it('allows cross-lab fallback when explicitly permitted', () => {
    const policy = makePolicy({ allowCrossLabFallback: true });
    const profile = makeProfile({ providerId: 'openai/gpt-5' });
    const result = enforceProviderPolicy(policy, profile, undefined, 'anthropic');
    expect(result.allowed).toBe(true);
  });

  it('blocks call for disabled surface', () => {
    const policy = makePolicy({
      sensitiveSurfaces: [
        { surfaceId: 'finance', mode: 'disabled', reason: 'No model calls for finance' },
      ],
    });
    const result = enforceProviderPolicy(policy, makeProfile(), 'finance');
    expect(result.allowed).toBe(false);
    expect(result.enforcedMode).toBe('disabled');
    expect(result.reason).toBe('No model calls for finance');
  });

  it('enforces surface-specific mode override', () => {
    const policy = makePolicy({
      sensitiveSurfaces: [
        { surfaceId: 'compliance', mode: 'local', reason: 'Must use local model' },
      ],
    });
    const profile = makeProfile({ adapter: 'host' });
    const result = enforceProviderPolicy(policy, profile, 'compliance');
    expect(result.allowed).toBe(false);
    expect(result.enforcedMode).toBe('local');
  });

  it('allows when surface override matches adapter', () => {
    const policy = makePolicy({
      sensitiveSurfaces: [
        { surfaceId: 'compliance', mode: 'host', reason: 'Must use host' },
      ],
    });
    const profile = makeProfile({ adapter: 'host' });
    const result = enforceProviderPolicy(policy, profile, 'compliance');
    expect(result.allowed).toBe(true);
  });
});

describe('filterAllowedProfiles', () => {
  it('returns only allowed profiles', () => {
    const policy = makePolicy({ allowedProviders: ['anthropic/claude-4'] });
    const profiles = [
      makeProfile({ providerId: 'anthropic/claude-4' }),
      makeProfile({ providerId: 'openai/gpt-5' }),
    ];
    const allowed = filterAllowedProfiles(policy, profiles);
    expect(allowed).toHaveLength(1);
    expect(allowed[0].providerId).toBe('anthropic/claude-4');
  });
});

describe('getSurfaceMode', () => {
  it('returns mode for configured surface', () => {
    const policy = makePolicy({
      sensitiveSurfaces: [
        { surfaceId: 'finance', mode: 'disabled', reason: 'test' },
      ],
    });
    expect(getSurfaceMode(policy, 'finance')).toBe('disabled');
  });

  it('returns undefined for unconfigured surface', () => {
    const policy = makePolicy();
    expect(getSurfaceMode(policy, 'unknown')).toBeUndefined();
  });
});
