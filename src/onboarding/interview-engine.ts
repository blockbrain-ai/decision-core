/**
 * Adaptive Interview Engine
 *
 * Starts with detection and memory inference results, then asks only
 * for missing or low-confidence fields. Users with strong memory evidence
 * answer fewer than five required questions.
 */

import type {
  OnboardingProfile,
  OnboardingProfileMode,
  AutonomyPosture,
  DefaultAction,
  ProfileProviderMode,
} from '../contracts/onboarding-profile.contracts.js';

// ===========================================================================
// Question Types
// ===========================================================================

export type InterviewFieldType = 'select' | 'multi_select' | 'text' | 'confirm';

export interface InterviewQuestion {
  id: string;
  field: string;
  prompt: string;
  type: InterviewFieldType;
  options?: string[];
  defaultValue?: string;
  required: boolean;
  condition?: (profile: OnboardingProfile) => boolean;
}

export interface InterviewPlan {
  questions: InterviewQuestion[];
  skippedCount: number;
  totalPossible: number;
  reason: string;
}

export interface InterviewAnswer {
  questionId: string;
  value: string | string[] | boolean;
}

// ===========================================================================
// Question Registry
// ===========================================================================

const ALL_QUESTIONS: InterviewQuestion[] = [
  {
    id: 'mode',
    field: 'mode',
    prompt: 'Is this for personal use, a team, a business, or an enterprise?',
    type: 'select',
    options: ['personal', 'team', 'business', 'enterprise'],
    defaultValue: 'personal',
    required: true,
  },
  {
    id: 'harness',
    field: 'agent.harness',
    prompt: 'What agent harness are you using?',
    type: 'select',
    options: ['openclaw', 'hermes', 'generic', 'standalone'],
    required: true,
    condition: (p) => p.agent.harness === 'unknown',
  },
  {
    id: 'primary_jobs',
    field: 'userContext.primaryJobs',
    prompt: "What are the agent's most important jobs? (comma-separated)",
    type: 'text',
    required: true,
    condition: (p) => p.userContext.primaryJobs.length === 0,
  },
  {
    id: 'destructive_tools',
    field: 'tools.destructive',
    prompt: 'Which tools can change external state? (e.g., deploy, delete, send email)',
    type: 'text',
    required: true,
    condition: (p) => p.tools.length === 0,
  },
  {
    id: 'high_risk_capabilities',
    field: 'tools.capabilities',
    prompt: 'Can the agent spend money, delete data, contact people, publish content, deploy code, or access sensitive data?',
    type: 'multi_select',
    options: [
      'spend_money',
      'delete_data',
      'contact_people',
      'publish_content',
      'deploy_code',
      'access_sensitive_data',
    ],
    required: true,
    condition: (p) => p.tools.length === 0,
  },
  {
    id: 'always_approve',
    field: 'autonomy.alwaysRequireApproval',
    prompt: 'What actions should always require human approval? (comma-separated, or "none")',
    type: 'text',
    required: false,
    condition: (p) => p.autonomy.alwaysRequireApproval.length === 0,
  },
  {
    id: 'provider_mode',
    field: 'provider.mode',
    prompt: 'Should Decision Core reuse the harness provider, run deterministic-only, call a provider directly, or use a local model?',
    type: 'select',
    options: ['host', 'disabled', 'direct', 'local'],
    defaultValue: 'disabled',
    required: true,
    condition: (p) => p.provider.mode === 'disabled' && p.agent.harness !== 'unknown',
  },
  {
    id: 'memory_consent',
    field: 'memory.consent',
    prompt: 'Which memory sources may setup inspect? (Select from detected sources, or "none")',
    type: 'multi_select',
    required: true,
    condition: (p) => p.memory.sources.some((s) => s.detected && !s.readConsent),
  },
  {
    id: 'writeback_consent',
    field: 'memory.writeback',
    prompt: 'May setup write a short onboarding summary back to memory after approval?',
    type: 'confirm',
    defaultValue: 'no',
    required: false,
  },
];

// ===========================================================================
// Mode Defaults
// ===========================================================================

export interface ModeDefaults {
  posture: AutonomyPosture;
  defaultAction: DefaultAction;
  providerMode: ProfileProviderMode;
  enforcementMode: 'enforce' | 'observe';
}

// Observe-first for everyone except enterprise: a fresh install must not break an
// operator's existing tools on day one. Enterprise (locked_down) opts into enforce.
const MODE_DEFAULTS: Record<OnboardingProfileMode, ModeDefaults> = {
  personal: { posture: 'guided', defaultAction: 'ask', providerMode: 'disabled', enforcementMode: 'observe' },
  team: { posture: 'balanced', defaultAction: 'ask', providerMode: 'host', enforcementMode: 'observe' },
  business: { posture: 'guided', defaultAction: 'ask', providerMode: 'host', enforcementMode: 'observe' },
  enterprise: { posture: 'locked_down', defaultAction: 'block', providerMode: 'host', enforcementMode: 'enforce' },
};

export function getModeDefaults(mode: OnboardingProfileMode): ModeDefaults {
  return MODE_DEFAULTS[mode];
}

// ===========================================================================
// Interview Planning
// ===========================================================================

export function planInterview(profile: OnboardingProfile): InterviewPlan {
  const totalPossible = ALL_QUESTIONS.length;

  const questions = ALL_QUESTIONS.filter((q) => {
    if (q.condition && !q.condition(profile)) return false;
    return true;
  });

  const skippedCount = totalPossible - questions.length;
  let reason: string;

  if (questions.length <= 3) {
    reason = 'Strong detection and memory evidence — minimal interview needed';
  } else if (questions.length <= 5) {
    reason = 'Partial detection — short interview for missing fields';
  } else {
    reason = 'Limited detection — full interview needed';
  }

  return { questions, skippedCount, totalPossible, reason };
}

// ===========================================================================
// Answer Application
// ===========================================================================

export function applyAnswer(
  profile: OnboardingProfile,
  answer: InterviewAnswer,
): OnboardingProfile {
  const updated = { ...profile, updatedAt: new Date().toISOString() };

  switch (answer.questionId) {
    case 'mode':
      updated.mode = answer.value as OnboardingProfileMode;
      break;

    case 'harness':
      updated.agent = { ...updated.agent, harness: answer.value as OnboardingProfile['agent']['harness'] };
      break;

    case 'primary_jobs': {
      const jobs = typeof answer.value === 'string'
        ? answer.value.split(',').map((j) => j.trim()).filter(Boolean)
        : [];
      updated.userContext = { ...updated.userContext, primaryJobs: jobs };
      break;
    }

    case 'destructive_tools': {
      const names = typeof answer.value === 'string'
        ? answer.value.split(',').map((n) => n.trim()).filter(Boolean)
        : [];
      updated.tools = names.map((name) => ({
        name,
        riskTier: 3 as const,
        canSpendMoney: false,
        canDeleteData: true,
        canContactPeople: false,
        canPublishContent: false,
        canDeployCode: false,
        accessesSensitiveData: false,
        defaultAction: 'ask' as const,
      }));
      break;
    }

    case 'high_risk_capabilities': {
      const caps = Array.isArray(answer.value) ? answer.value : [];
      for (const tool of updated.tools) {
        if (caps.includes('spend_money')) tool.canSpendMoney = true;
        if (caps.includes('delete_data')) tool.canDeleteData = true;
        if (caps.includes('contact_people')) tool.canContactPeople = true;
        if (caps.includes('publish_content')) tool.canPublishContent = true;
        if (caps.includes('deploy_code')) tool.canDeployCode = true;
        if (caps.includes('access_sensitive_data')) tool.accessesSensitiveData = true;
      }
      const hasHighRisk = caps.some((c) =>
        ['spend_money', 'delete_data', 'deploy_code'].includes(c as string),
      );
      if (hasHighRisk) {
        for (const tool of updated.tools) {
          if (tool.canSpendMoney || tool.canDeleteData || tool.canDeployCode) {
            tool.riskTier = 4;
            tool.defaultAction = 'block';
          }
        }
      }
      break;
    }

    case 'always_approve': {
      const actions = typeof answer.value === 'string'
        ? answer.value.split(',').map((a) => a.trim()).filter((a) => a && a !== 'none')
        : [];
      updated.autonomy = { ...updated.autonomy, alwaysRequireApproval: actions };
      break;
    }

    case 'provider_mode':
      updated.provider = { ...updated.provider, mode: answer.value as ProfileProviderMode };
      break;

    case 'memory_consent': {
      const consented = Array.isArray(answer.value) ? answer.value : [];
      updated.memory = {
        ...updated.memory,
        sources: updated.memory.sources.map((s) => ({
          ...s,
          readConsent: consented.includes(s.kind),
        })),
      };
      break;
    }

    case 'writeback_consent': {
      const granted = answer.value === true || answer.value === 'yes';
      updated.memory = {
        ...updated.memory,
        sources: updated.memory.sources.map((s) => ({
          ...s,
          writeBackConsent: s.readConsent && granted,
        })),
      };
      break;
    }
  }

  return updated;
}

export function applyModeDefaults(profile: OnboardingProfile): OnboardingProfile {
  const defaults = getModeDefaults(profile.mode);
  return {
    ...profile,
    updatedAt: new Date().toISOString(),
    autonomy: {
      ...profile.autonomy,
      posture: profile.autonomy.posture === 'guided' ? defaults.posture : profile.autonomy.posture,
      defaultAction: profile.autonomy.defaultAction === 'ask' ? defaults.defaultAction : profile.autonomy.defaultAction,
      // At the observe default, defer to the mode (enterprise → enforce); an
      // explicit 'enforce' the operator chose is preserved.
      enforcementMode: profile.autonomy.enforcementMode === 'observe' ? defaults.enforcementMode : profile.autonomy.enforcementMode,
    },
    provider: {
      ...profile.provider,
      mode: profile.provider.mode === 'disabled' ? defaults.providerMode : profile.provider.mode,
    },
  };
}

export function applyAllAnswers(
  profile: OnboardingProfile,
  answers: InterviewAnswer[],
): OnboardingProfile {
  let updated = profile;
  for (const answer of answers) {
    updated = applyAnswer(updated, answer);
  }
  return applyModeDefaults(updated);
}
