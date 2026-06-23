import { describe, it, expect } from 'vitest';
import {
  ProviderProfileSchema,
  ValidatedProviderProfileSchema,
  selectProfileForPurpose,
  selectFallbackProfile,
  type ProviderProfile,
} from './provider-profiles.js';

function makeProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    providerId: 'anthropic/claude-4',
    modelId: 'claude-4-sonnet',
    adapter: 'host',
    purposes: ['general'],
    capabilities: ['structured-output', 'reasoning'],
    dataBoundary: 'global',
    credentialSource: 'host-callback',
    timeoutMs: 30000,
    maxRetries: 1,
    ...overrides,
  };
}

describe('ProviderProfileSchema', () => {
  it('validates a correct profile', () => {
    const result = ProviderProfileSchema.safeParse(makeProfile());
    expect(result.success).toBe(true);
  });

  it('rejects profile with empty providerId', () => {
    const result = ProviderProfileSchema.safeParse(makeProfile({ providerId: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects profile with invalid adapter', () => {
    const result = ProviderProfileSchema.safeParse({ ...makeProfile(), adapter: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects profile with empty purposes array', () => {
    const result = ProviderProfileSchema.safeParse(makeProfile({ purposes: [] }));
    expect(result.success).toBe(false);
  });

  it('accepts profile with all valid capabilities', () => {
    const result = ProviderProfileSchema.safeParse(
      makeProfile({
        capabilities: ['structured-output', 'function-calling', 'streaming', 'long-context'],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects profile with invalid data boundary', () => {
    const result = ProviderProfileSchema.safeParse({ ...makeProfile(), dataBoundary: 'mars' });
    expect(result.success).toBe(false);
  });

  it('applies default timeoutMs', () => {
    const input = { ...makeProfile() };
    delete (input as Record<string, unknown>)['timeoutMs'];
    const result = ProviderProfileSchema.parse(input);
    expect(result.timeoutMs).toBe(30000);
  });
});

describe('ValidatedProviderProfileSchema', () => {
  it('rejects direct adapter without envVarName', () => {
    const result = ValidatedProviderProfileSchema.safeParse(
      makeProfile({ adapter: 'direct', credentialSource: 'env-var' }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts direct adapter with envVarName', () => {
    const result = ValidatedProviderProfileSchema.safeParse(
      makeProfile({ adapter: 'direct', credentialSource: 'env-var', envVarName: 'MY_KEY' }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects local adapter without endpoint', () => {
    const result = ValidatedProviderProfileSchema.safeParse(
      makeProfile({ adapter: 'local', credentialSource: 'none' }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts local adapter with endpoint', () => {
    const result = ValidatedProviderProfileSchema.safeParse(
      makeProfile({
        adapter: 'local',
        credentialSource: 'none',
        endpoint: 'http://localhost:11434/v1',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects host adapter with non-host-callback credential source', () => {
    const result = ValidatedProviderProfileSchema.safeParse(
      makeProfile({ adapter: 'host', credentialSource: 'env-var' }),
    );
    expect(result.success).toBe(false);
  });
});

describe('selectProfileForPurpose', () => {
  const profiles: ProviderProfile[] = [
    makeProfile({ providerId: 'a', purposes: ['tribunal', 'reviewer'] }),
    makeProfile({ providerId: 'b', purposes: ['general'] }),
    makeProfile({ providerId: 'c', purposes: ['explanation'], adapter: 'disabled' }),
  ];

  it('selects exact purpose match', () => {
    const selected = selectProfileForPurpose(profiles, 'tribunal');
    expect(selected?.providerId).toBe('a');
  });

  it('falls back to general-purpose profile', () => {
    const selected = selectProfileForPurpose(profiles, 'policy-authoring');
    expect(selected?.providerId).toBe('b');
  });

  it('skips disabled profiles', () => {
    const selected = selectProfileForPurpose(profiles, 'explanation');
    expect(selected?.providerId).toBe('b'); // Falls to general, not disabled
  });

  it('returns undefined if no profile matches', () => {
    const selected = selectProfileForPurpose(
      [makeProfile({ purposes: ['tribunal'], adapter: 'disabled' })],
      'tribunal',
    );
    expect(selected).toBeUndefined();
  });
});

describe('selectFallbackProfile', () => {
  const profiles: ProviderProfile[] = [
    makeProfile({ providerId: 'a', purposes: ['general'], fallbackGroup: 'tier1' }),
    makeProfile({ providerId: 'b', purposes: ['general'], fallbackGroup: 'tier1' }),
    makeProfile({ providerId: 'c', purposes: ['general'], fallbackGroup: 'tier2' }),
  ];

  it('selects fallback from same group', () => {
    const fallback = selectFallbackProfile(profiles, profiles[0], 'general');
    expect(fallback?.providerId).toBe('b');
  });

  it('returns undefined for different fallback group', () => {
    const fallback = selectFallbackProfile(profiles, profiles[2], 'general');
    expect(fallback).toBeUndefined();
  });

  it('returns undefined when no fallback group set', () => {
    const noGroup = makeProfile({ providerId: 'x', fallbackGroup: undefined });
    const fallback = selectFallbackProfile(profiles, noGroup, 'general');
    expect(fallback).toBeUndefined();
  });
});
