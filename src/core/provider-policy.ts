/**
 * Provider Policy
 *
 * Controls which providers are allowed, whether cross-lab fallback
 * is permitted, and per-surface overrides. Enforcement happens
 * before every model call.
 */

import { z } from 'zod';
import { type AdapterType, type ProviderProfile } from './provider-profiles.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('provider-policy');

// ===========================================================================
// Surface Override
// ===========================================================================

export const SurfaceOverrideSchema = z.object({
  surfaceId: z.string().min(1),
  mode: z.enum(['host', 'disabled', 'direct', 'local', 'router']),
  reason: z.string().min(1),
});
export type SurfaceOverride = z.infer<typeof SurfaceOverrideSchema>;

// ===========================================================================
// Provider Policy Schema
// ===========================================================================

export const ProviderPolicySchema = z.object({
  allowedProviders: z.array(z.string().min(1)),
  allowCrossLabFallback: z.boolean().default(false),
  sensitiveSurfaces: z.array(SurfaceOverrideSchema).default([]),
  policyVersion: z.string().min(1),
});
export type ProviderPolicy = z.infer<typeof ProviderPolicySchema>;

// ===========================================================================
// Lab Extraction
// ===========================================================================

/**
 * Extract the lab (organization) from a provider ID.
 * Convention: providerId format is "lab/model-name" or just "lab".
 */
export function extractLab(providerId: string): string {
  const slash = providerId.indexOf('/');
  return slash > 0 ? providerId.substring(0, slash) : providerId;
}

// ===========================================================================
// Policy Enforcement
// ===========================================================================

export interface PolicyEnforcementResult {
  allowed: boolean;
  reason?: string;
  enforcedMode?: AdapterType;
}

/**
 * Check if a provider is allowed by the policy.
 */
export function enforceProviderPolicy(
  policy: ProviderPolicy,
  profile: ProviderProfile,
  surfaceId?: string,
  currentLab?: string,
): PolicyEnforcementResult {
  // Check surface-specific overrides first
  if (surfaceId) {
    const override = policy.sensitiveSurfaces.find(s => s.surfaceId === surfaceId);
    if (override) {
      if (override.mode === 'disabled') {
        logger.info({ surfaceId, reason: override.reason }, 'Surface override blocks model call');
        return { allowed: false, reason: override.reason, enforcedMode: 'disabled' };
      }
      // Surface has a specific mode enforced
      if (override.mode !== profile.adapter) {
        logger.info(
          { surfaceId, requiredMode: override.mode, profileAdapter: profile.adapter },
          'Surface override enforces different mode',
        );
        return { allowed: false, reason: override.reason, enforcedMode: override.mode };
      }
    }
  }

  // Check provider allowlist
  if (policy.allowedProviders.length > 0 && !policy.allowedProviders.includes(profile.providerId)) {
    logger.info({ providerId: profile.providerId }, 'Provider not in allowlist');
    return { allowed: false, reason: `Provider '${profile.providerId}' not in allowlist` };
  }

  // Check cross-lab fallback
  if (currentLab && !policy.allowCrossLabFallback) {
    const profileLab = extractLab(profile.providerId);
    if (profileLab !== currentLab) {
      logger.info(
        { currentLab, profileLab, providerId: profile.providerId },
        'Cross-lab fallback blocked',
      );
      return {
        allowed: false,
        reason: `Cross-lab fallback from '${currentLab}' to '${profileLab}' not allowed`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Filter profiles to only those allowed by policy.
 */
export function filterAllowedProfiles(
  policy: ProviderPolicy,
  profiles: ProviderProfile[],
  surfaceId?: string,
  currentLab?: string,
): ProviderProfile[] {
  return profiles.filter(p => {
    const result = enforceProviderPolicy(policy, p, surfaceId, currentLab);
    return result.allowed;
  });
}

/**
 * Get the enforced mode for a surface, if any override exists.
 */
export function getSurfaceMode(
  policy: ProviderPolicy,
  surfaceId: string,
): AdapterType | undefined {
  const override = policy.sensitiveSurfaces.find(s => s.surfaceId === surfaceId);
  return override?.mode;
}
