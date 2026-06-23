/**
 * Provider Profile Credential Validation
 *
 * Validates that provider profiles reference credentials correctly:
 * - env-var profiles must specify envVarName
 * - envVarName must be set in environment (presence check only)
 * - Credential values are never logged or returned
 */

import { createLogger } from '../utils/logger.js';
import type { ProviderProfile } from './provider-profiles.js';

const logger = createLogger('credential-validation');

export interface CredentialValidationResult {
  providerId: string;
  valid: boolean;
  errors: string[];
}

/**
 * Validate credential configuration for a single provider profile.
 * Checks env var presence without logging the actual value.
 */
export function validateProfileCredentials(profile: ProviderProfile): CredentialValidationResult {
  const errors: string[] = [];

  if (profile.credentialSource === 'env-var') {
    if (!profile.envVarName) {
      errors.push('Credential source is env-var but envVarName is not specified');
    } else if (!process.env[profile.envVarName]) {
      errors.push(`Environment variable '${profile.envVarName}' is not set`);
    }
    // Never log the env var value — only its name
    logger.debug({ providerId: profile.providerId, envVarName: profile.envVarName }, 'Credential presence check');
  }

  if (profile.adapter === 'direct' && !profile.envVarName) {
    errors.push('Direct adapter requires envVarName');
  }

  if (profile.adapter === 'host' && profile.credentialSource !== 'host-callback') {
    errors.push('Host adapter must use host-callback credential source');
  }

  return {
    providerId: profile.providerId,
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate credentials for all provider profiles.
 * Returns only validation results — never exposes credential values.
 */
export function validateAllProfileCredentials(
  profiles: ProviderProfile[],
): CredentialValidationResult[] {
  const results = profiles.map(validateProfileCredentials);

  const valid = results.filter(r => r.valid).length;
  const invalid = results.filter(r => !r.valid).length;

  logger.info(
    { totalProfiles: profiles.length, valid, invalid },
    'Credential validation complete',
  );

  return results;
}
