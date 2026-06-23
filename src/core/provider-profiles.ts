/**
 * Provider Profiles
 *
 * Capability-based provider profile schema. No hard-coded vendors.
 * Profiles define what a provider can do, not who it is.
 */

import { z } from 'zod';

// ===========================================================================
// Adapter Types
// ===========================================================================

export const ADAPTER_TYPES = ['host', 'disabled', 'direct', 'local', 'router'] as const;
export const AdapterTypeSchema = z.enum(ADAPTER_TYPES);
export type AdapterType = z.infer<typeof AdapterTypeSchema>;

// ===========================================================================
// Provider Purposes
// ===========================================================================

export const PROVIDER_PURPOSES = [
  'policy-authoring',
  'clause-extraction',
  'tribunal',
  'reviewer',
  'explanation',
  'memory-summary',
  'general',
] as const;
export const ProviderPurposeSchema = z.enum(PROVIDER_PURPOSES);
export type ProviderPurpose = z.infer<typeof ProviderPurposeSchema>;

// ===========================================================================
// Provider Capabilities
// ===========================================================================

export const PROVIDER_CAPABILITIES = [
  'structured-output',
  'function-calling',
  'streaming',
  'long-context',
  'vision',
  'code-generation',
  'reasoning',
  'low-latency',
] as const;
export const ProviderCapabilitySchema = z.enum(PROVIDER_CAPABILITIES);
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;

// ===========================================================================
// Data Boundary
// ===========================================================================

export const DATA_BOUNDARIES = ['local', 'regional', 'global', 'air-gapped'] as const;
export const DataBoundarySchema = z.enum(DATA_BOUNDARIES);
export type DataBoundary = z.infer<typeof DataBoundarySchema>;

// ===========================================================================
// Credential Source
// ===========================================================================

export const CREDENTIAL_SOURCES = ['host-callback', 'env-var', 'none'] as const;
export const CredentialSourceSchema = z.enum(CREDENTIAL_SOURCES);
export type CredentialSource = z.infer<typeof CredentialSourceSchema>;

// ===========================================================================
// Provider Profile
// ===========================================================================

export const ProviderProfileSchema = z.object({
  providerId: z.string().min(1).max(128),
  modelId: z.string().min(1).max(256),
  adapter: AdapterTypeSchema,
  purposes: z.array(ProviderPurposeSchema).min(1),
  capabilities: z.array(ProviderCapabilitySchema),
  dataBoundary: DataBoundarySchema,
  credentialSource: CredentialSourceSchema,
  fallbackGroup: z.string().min(1).max(64).optional(),
  endpoint: z.string().url().optional(),
  envVarName: z.string().min(1).max(128).optional(),
  timeoutMs: z.number().int().positive().default(30000),
  maxRetries: z.number().int().nonnegative().default(1),
});

export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;

// ===========================================================================
// Profile Validation Refinements
// ===========================================================================

export const ValidatedProviderProfileSchema = ProviderProfileSchema.superRefine((profile, ctx) => {
  if (profile.adapter === 'direct' && !profile.envVarName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Direct adapter requires envVarName for credential reference',
      path: ['envVarName'],
    });
  }

  if (profile.adapter === 'local' && !profile.endpoint) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Local adapter requires endpoint URL',
      path: ['endpoint'],
    });
  }

  if (profile.adapter === 'host' && profile.credentialSource !== 'host-callback') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Host adapter must use host-callback credential source',
      path: ['credentialSource'],
    });
  }

  if (profile.adapter === 'disabled' && profile.purposes.length > 0) {
    // Disabled adapters can still declare purposes for documentation,
    // but we note that they won't serve requests
  }
});

// ===========================================================================
// Profile Selection
// ===========================================================================

/**
 * Select the best profile for a given purpose from a list of profiles.
 * Prefers profiles that explicitly list the purpose over general-purpose ones.
 */
export function selectProfileForPurpose(
  profiles: ProviderProfile[],
  purpose: ProviderPurpose,
): ProviderProfile | undefined {
  // First pass: exact purpose match
  const exact = profiles.filter(p => p.adapter !== 'disabled' && p.purposes.includes(purpose));
  if (exact.length > 0) return exact[0];

  // Second pass: general-purpose profiles
  const general = profiles.filter(p => p.adapter !== 'disabled' && p.purposes.includes('general'));
  if (general.length > 0) return general[0];

  return undefined;
}

/**
 * Select a fallback profile from the same fallback group.
 */
export function selectFallbackProfile(
  profiles: ProviderProfile[],
  currentProfile: ProviderProfile,
  purpose: ProviderPurpose,
): ProviderProfile | undefined {
  if (!currentProfile.fallbackGroup) return undefined;

  return profiles.find(
    p =>
      p.providerId !== currentProfile.providerId &&
      p.adapter !== 'disabled' &&
      p.fallbackGroup === currentProfile.fallbackGroup &&
      (p.purposes.includes(purpose) || p.purposes.includes('general')),
  );
}
