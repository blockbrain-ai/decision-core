/**
 * Memory Evidence Profile Inference
 *
 * Extracts profile field suggestions from imported memory evidence.
 * Evidence items may contain suggestedProfilePatch or keyword signals
 * that map to profile fields.
 */

import type { OnboardingProfile, OnboardingProfileMode, AutonomyPosture, ProfileTool, DataClass } from '../../contracts/onboarding-profile.contracts.js';
import type { MemoryEvidenceExport } from './memory-evidence.contracts.js';

// ===========================================================================
// Inference Result
// ===========================================================================

export interface ProfileInferenceResult {
  suggestedMode?: OnboardingProfileMode;
  suggestedPosture?: AutonomyPosture;
  suggestedTools: ProfileTool[];
  suggestedDataClasses: DataClass[];
  suggestedJobs: string[];
  suggestedDomain?: string;
  inferenceNotes: string[];
  confidenceAvg: number;
  itemsUsed: number;
}

// ===========================================================================
// Keyword Signals
// ===========================================================================

const MODE_SIGNALS: Record<string, OnboardingProfileMode> = {
  enterprise: 'enterprise',
  corporation: 'enterprise',
  'large organization': 'enterprise',
  compliance: 'enterprise',
  regulated: 'enterprise',
  business: 'business',
  company: 'business',
  'small business': 'business',
  startup: 'business',
  team: 'team',
  department: 'team',
  squad: 'team',
  personal: 'personal',
  individual: 'personal',
  hobby: 'personal',
  solo: 'personal',
};

const POSTURE_SIGNALS: Record<string, AutonomyPosture> = {
  'locked down': 'locked_down',
  'strict approval': 'locked_down',
  'no autonomy': 'locked_down',
  cautious: 'guided',
  supervised: 'guided',
  guided: 'guided',
  balanced: 'balanced',
  moderate: 'balanced',
  autonomous: 'high_autonomy',
  'full autonomy': 'high_autonomy',
  independent: 'high_autonomy',
};

const DATA_CLASS_SIGNALS: Record<string, DataClass> = {
  pii: 'pii',
  'personal data': 'pii',
  'user data': 'pii',
  gdpr: 'pii',
  financial: 'financial',
  revenue: 'financial',
  payment: 'financial',
  billing: 'financial',
  credentials: 'credentials',
  'api key': 'credentials',
  'secret key': 'credentials',
  'password manager': 'credentials',
  'access token': 'credentials',
  health: 'health',
  hipaa: 'health',
  medical: 'health',
  legal: 'legal',
  contract: 'legal',
  'terms of service': 'legal',
  confidential: 'confidential',
  proprietary: 'confidential',
  'trade secret': 'confidential',
  internal: 'internal',
  restricted: 'restricted',
};

// ===========================================================================
// Inference Logic
// ===========================================================================

function searchKeywords<T>(text: string, signals: Record<string, T>): T | undefined {
  const lower = text.toLowerCase();
  for (const [keyword, value] of Object.entries(signals)) {
    if (lower.includes(keyword)) return value;
  }
  return undefined;
}

export function inferProfileFromEvidence(
  exports: MemoryEvidenceExport[],
): ProfileInferenceResult {
  const result: ProfileInferenceResult = {
    suggestedTools: [],
    suggestedDataClasses: [],
    suggestedJobs: [],
    inferenceNotes: [],
    confidenceAvg: 0,
    itemsUsed: 0,
  };

  const modeVotes: Map<OnboardingProfileMode, number> = new Map();
  const postureVotes: Map<AutonomyPosture, number> = new Map();
  const dataClasses = new Set<DataClass>();
  const jobs = new Set<string>();
  let totalConfidence = 0;
  let itemCount = 0;

  for (const exp of exports) {
    if (!exp.consent.readGranted) continue;

    for (const item of exp.items) {
      itemCount++;
      totalConfidence += item.confidence;

      if (item.suggestedProfilePatch) {
        const patch = item.suggestedProfilePatch as Record<string, unknown>;
        if (patch.mode && typeof patch.mode === 'string') {
          const m = patch.mode as OnboardingProfileMode;
          modeVotes.set(m, (modeVotes.get(m) ?? 0) + item.confidence);
        }
      }

      const mode = searchKeywords(item.summary, MODE_SIGNALS);
      if (mode) {
        modeVotes.set(mode, (modeVotes.get(mode) ?? 0) + item.confidence * 0.5);
      }

      const posture = searchKeywords(item.summary, POSTURE_SIGNALS);
      if (posture) {
        postureVotes.set(posture, (postureVotes.get(posture) ?? 0) + item.confidence);
      }

      for (const [keyword, cls] of Object.entries(DATA_CLASS_SIGNALS)) {
        if (item.summary.toLowerCase().includes(keyword)) {
          dataClasses.add(cls);
        }
      }

      const jobMatch = item.summary.match(/(?:manages?|handles?|processes?|automates?)\s+([^.,:;]+)/i);
      if (jobMatch) {
        jobs.add(jobMatch[1].trim());
      }
    }
  }

  if (modeVotes.size > 0) {
    result.suggestedMode = [...modeVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    result.inferenceNotes.push(`Mode inferred from ${modeVotes.size} signal(s)`);
  }

  if (postureVotes.size > 0) {
    result.suggestedPosture = [...postureVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    result.inferenceNotes.push(`Posture inferred from ${postureVotes.size} signal(s)`);
  }

  result.suggestedDataClasses = [...dataClasses];
  result.suggestedJobs = [...jobs].slice(0, 10);
  result.confidenceAvg = itemCount > 0 ? totalConfidence / itemCount : 0;
  result.itemsUsed = itemCount;

  return result;
}

export function applyInferenceToProfile(
  profile: OnboardingProfile,
  inference: ProfileInferenceResult,
): OnboardingProfile {
  const updated = { ...profile, updatedAt: new Date().toISOString() };

  if (inference.suggestedMode && profile.mode === 'personal') {
    updated.mode = inference.suggestedMode;
  }

  if (inference.suggestedPosture && profile.autonomy.posture === 'guided') {
    updated.autonomy = { ...updated.autonomy, posture: inference.suggestedPosture };
  }

  if (inference.suggestedJobs.length > 0 && profile.userContext.primaryJobs.length === 0) {
    updated.userContext = { ...updated.userContext, primaryJobs: inference.suggestedJobs };
  }

  if (inference.suggestedDomain && !profile.userContext.domain) {
    updated.userContext = { ...updated.userContext, domain: inference.suggestedDomain };
  }

  if (inference.suggestedDataClasses.length > 0 && profile.data.classes.length === 0) {
    updated.data = { ...updated.data, classes: inference.suggestedDataClasses };
  }

  return updated;
}
