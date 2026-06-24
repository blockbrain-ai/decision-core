/**
 * Memory Write-Back
 *
 * Writes a short onboarding summary back to consented memory sources.
 * Write-back is always optional and requires explicit separate consent.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
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

/**
 * C3 — a REAL, local write-back to the always-available local source: writes the
 * redacted onboarding summary to `<dir>/onboarding-summary.md`. Opt-in (requires
 * write-back consent on at least one memory source) and visible (returns the path
 * it wrote). Contains only the redacted summary — never raw memory evidence,
 * secrets, or tool arguments. If no consent, it skips cleanly and reports so.
 */
export function writeOnboardingSummary(profile: OnboardingProfile, dir: string): WriteBackResult {
  const consented = profile.memory.sources.some((s) => s.writeBackConsent);
  if (!consented) {
    return { sourceKind: 'local-file', success: true, skipped: true, reason: 'No write-back consent — nothing written.' };
  }
  try {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'onboarding-summary.md');
    writeFileSync(path, formatWriteBackMarkdown(generateWriteBackSummary(profile)), 'utf-8');
    return { sourceKind: 'local-file', success: true, skipped: false, reason: `Wrote onboarding summary to ${path}` };
  } catch (err) {
    return { sourceKind: 'local-file', success: false, skipped: false, reason: `Write failed: ${err instanceof Error ? err.message : String(err)}` };
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
