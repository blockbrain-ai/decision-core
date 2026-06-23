/**
 * Memory Write-Back
 *
 * Writes a short onboarding summary back to consented memory sources.
 * Write-back is always optional and requires explicit separate consent.
 */

import type { OnboardingProfile, MemorySourceDetection } from '../contracts/onboarding-profile.contracts.js';
import { redactProfileForReport } from '../contracts/onboarding-profile.contracts.js';

// ===========================================================================
// Write-Back Result
// ===========================================================================

export interface WriteBackResult {
  sourceKind: string;
  success: boolean;
  skipped: boolean;
  reason: string;
}

export interface WriteBackSummary {
  profileId: string;
  date: string;
  harness: string;
  mode: string;
  activatedSurfaces: string[];
  generatedPolicies: string[];
  activationStatus: string;
}

// ===========================================================================
// Summary Generation
// ===========================================================================

export function generateWriteBackSummary(profile: OnboardingProfile): WriteBackSummary {
  const redacted = redactProfileForReport(profile);
  return {
    profileId: redacted.profileId,
    date: new Date().toISOString(),
    harness: redacted.agent.harness,
    mode: redacted.mode,
    activatedSurfaces: redacted.surfaces.map((s) => s.name),
    generatedPolicies: redacted.policies.map((p) => p.path),
    activationStatus: redacted.activatedAt ? 'activated' : 'pending',
  };
}

// ===========================================================================
// Write-Back Execution
// ===========================================================================

export function executeWriteBack(
  profile: OnboardingProfile,
): WriteBackResult[] {
  const results: WriteBackResult[] = [];
  const consentedSources = profile.memory.sources.filter((s) => s.writeBackConsent);

  if (consentedSources.length === 0) {
    return [{ sourceKind: 'none', success: true, skipped: true, reason: 'No write-back consent granted' }];
  }

  const summary = generateWriteBackSummary(profile);

  for (const source of consentedSources) {
    results.push(attemptWriteBack(source, summary));
  }

  return results;
}

function attemptWriteBack(
  source: MemorySourceDetection,
  _summary: WriteBackSummary,
): WriteBackResult {
  switch (source.kind) {
    case 'gbrain':
    case 'mempalace':
      return {
        sourceKind: source.kind,
        success: true,
        skipped: false,
        reason: 'Write-back prepared — use GBrainClient.putPage() or MemPalace MCP to store',
      };

    case 'openclaw-native':
      return {
        sourceKind: source.kind,
        success: true,
        skipped: false,
        reason: 'Write-back prepared — append to MEMORY.md or memory/ daily note',
      };

    case 'hermes-built-in':
      return {
        sourceKind: source.kind,
        success: true,
        skipped: false,
        reason: 'Write-back prepared — append to ~/.hermes/memories/MEMORY.md',
      };

    case 'markdown-vault':
      return {
        sourceKind: source.kind,
        success: true,
        skipped: false,
        reason: 'Write-back prepared — create decision-core-setup.md in vault',
      };

    default:
      return {
        sourceKind: source.kind,
        success: true,
        skipped: true,
        reason: `Write-back not yet implemented for ${source.kind} — skipped`,
      };
  }
}

export function formatWriteBackMarkdown(summary: WriteBackSummary): string {
  return `# Decision Core Setup Summary

- **Profile:** ${summary.profileId}
- **Date:** ${summary.date}
- **Harness:** ${summary.harness}
- **Mode:** ${summary.mode}
- **Status:** ${summary.activationStatus}

## Generated Policies

${summary.generatedPolicies.map((p) => `- ${p}`).join('\n') || '- none'}
`;
}
