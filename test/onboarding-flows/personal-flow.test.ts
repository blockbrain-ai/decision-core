/**
 * Personal Onboarding Flow Tests
 *
 * Proves:
 *  - A personal user path creates no org files and remains simple.
 *  - Generated policy uses personal-mode defaults (guided posture, ask action).
 *  - No agent registry, access-policy, or per-agent tokens appear.
 *  - Profile-based flow produces valid artifacts that pass validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  OnboardingService,
  generatePoliciesYaml,
  generateProviderYaml,
  generateAllConfig,
  validateGeneratedConfig,
  classifyTools,
} from '../../src/skills/onboarding/onboarding.service.js';
import {
  createEmptyProfile,
  OnboardingProfileSchema,
} from '../../src/contracts/onboarding-profile.contracts.js';
import type { OnboardingProfile } from '../../src/contracts/onboarding-profile.contracts.js';
import type { AllAnswers } from '../../src/contracts/onboarding.contracts.js';
import { applyModeDefaults, planInterview, applyAllAnswers } from '../../src/onboarding/interview-engine.js';
import { generateArtifacts } from '../../src/onboarding/generate-artifacts.js';

// ===========================================================================
// Helpers
// ===========================================================================

function makePersonalAnswers(): AllAnswers {
  return {
    phase1: {
      agentDescription: 'Personal code review helper',
      agentTools: ['public-report-read', 'public-status-read'],
      dataAccess: ['public_data'],
      environment: 'local_dev',
    },
    phase2: {
      highRiskTools: [],
      mediumRiskTools: [],
      externalServices: false,
      canSpendMoney: false,
      piiHandling: false,
    },
    phase3: {
      riskProfile: 'personal',
      teamSize: 'solo',
      complianceRequirements: ['none'],
      approvalWorkflow: 'log_only',
    },
    phase4: {
      providerMode: 'local',
    },
  };
}

function makePersonalProfile(): OnboardingProfile {
  const profile = createEmptyProfile('personal-test');
  return {
    ...profile,
    mode: 'personal',
    agent: {
      harness: 'generic',
      detectedTools: ['public-report-read', 'public-status-read'],
      detectedCapabilities: [],
      configPaths: [],
    },
    userContext: {
      description: 'Personal code review helper',
      primaryJobs: ['code-review'],
    },
    autonomy: {
      posture: 'guided',
      defaultAction: 'ask',
      alwaysRequireApproval: [],
      neverAllow: [],
    },
    provider: { mode: 'local' },
    data: {
      classes: ['public'],
      handlingObligations: [],
      complianceFrameworks: [],
    },
    tools: [
      {
        name: 'public-report-read',
        riskTier: 1,
        canSpendMoney: false,
        canDeleteData: false,
        canContactPeople: false,
        canPublishContent: false,
        canDeployCode: false,
        accessesSensitiveData: false,
        defaultAction: 'allow',
      },
      {
        name: 'public-status-read',
        riskTier: 1,
        canSpendMoney: false,
        canDeleteData: false,
        canContactPeople: false,
        canPublishContent: false,
        canDeployCode: false,
        accessesSensitiveData: false,
        defaultAction: 'allow',
      },
    ],
    surfaces: [],
    policies: [],
    evidence: [],
  };
}

// ===========================================================================
// Legacy interview-based flow
// ===========================================================================

describe('onboarding: personal flow (legacy interview)', () => {
  let service: OnboardingService;

  beforeEach(() => {
    service = new OnboardingService();
  });

  it('completes the 4-phase interview and produces a result', () => {
    const answers = makePersonalAnswers();
    const { sessionId } = service.startOnboarding('tenant-personal');

    const r1 = service.processPhaseAnswers(sessionId, 1, answers.phase1);
    expect(r1.nextPhase).toBeDefined();

    const r2 = service.processPhaseAnswers(sessionId, 2, answers.phase2);
    expect(r2.nextPhase).toBeDefined();

    const r3 = service.processPhaseAnswers(sessionId, 3, answers.phase3);
    expect(r3.nextPhase).toBeDefined();

    const r4 = service.processPhaseAnswers(sessionId, 4, answers.phase4);
    expect(r4.result).toBeDefined();
    expect(r4.result!.riskProfile).toBe('personal');
    expect(r4.result!.providerMode).toBe('local');
  });

  it('classifies tools as low-risk when none are high or medium', () => {
    const answers = makePersonalAnswers();
    const tools = classifyTools(answers);
    expect(tools).toHaveLength(2);
    for (const tool of tools) {
      expect(tool.riskClass).toBe('low');
    }
  });

  it('generates policies with no approval requirements', () => {
    const answers = makePersonalAnswers();
    const yaml = generatePoliciesYaml(answers);
    const parsed = parseYaml(yaml) as { rules: Array<Record<string, unknown>> };
    expect(parsed.rules.length).toBeGreaterThan(0);

    for (const rule of parsed.rules) {
      expect(rule.requireApproval).toBe(false);
    }
  });

  it('generates no org-level artifacts (no agents.yaml, no access-policy.yaml)', () => {
    const answers = makePersonalAnswers();
    const config = generateAllConfig(answers);

    // Surfaces should have no 'restricted' tier requiring approval
    const surfaces = parseYaml(config.surfaces) as { surfaces: Array<Record<string, unknown>> };
    const restricted = surfaces.surfaces.filter(s => s.trustTier === 'high');
    expect(restricted).toHaveLength(0);

    // Provider config should not contain org-level fields
    const provider = parseYaml(config.provider) as Record<string, unknown>;
    expect(provider).not.toHaveProperty('agentRegistry');
    expect(provider).not.toHaveProperty('accessPolicy');
    expect(provider).not.toHaveProperty('perAgentTokens');
  });

  it('validates generated config without errors', () => {
    const answers = makePersonalAnswers();
    const config = generateAllConfig(answers);
    const result = validateGeneratedConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('provider config is simple with local mode', () => {
    const answers = makePersonalAnswers();
    const yaml = generateProviderYaml(answers);
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    const provider = parsed.provider as Record<string, unknown>;
    expect(provider.mode).toBe('local');
  });
});

// ===========================================================================
// Profile-based flow
// ===========================================================================

describe('onboarding: personal flow (profile-based)', () => {
  it('personal profile validates against OnboardingProfileSchema', () => {
    const profile = makePersonalProfile();
    const result = OnboardingProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it('mode defaults apply guided posture for personal', () => {
    const profile = createEmptyProfile('personal-defaults');
    profile.mode = 'personal';
    const updated = applyModeDefaults(profile);
    expect(updated.autonomy.posture).toBe('guided');
    expect(updated.autonomy.defaultAction).toBe('ask');
  });

  it('interview plan asks few questions when tools and harness are known', () => {
    const profile = makePersonalProfile();
    const plan = planInterview(profile);
    // With harness known, tools present, primaryJobs filled, many questions are skipped
    expect(plan.skippedCount).toBeGreaterThan(0);
    expect(plan.questions.length).toBeLessThan(plan.totalPossible);
  });

  it('generates artifacts with no org-level files', () => {
    const profile = makePersonalProfile();
    const result = generateArtifacts(profile);
    const paths = result.artifacts.map(a => a.path);

    // No org-level files
    expect(paths.find(p => p.includes('agents.yaml'))).toBeUndefined();
    expect(paths.find(p => p.includes('access-policy.yaml'))).toBeUndefined();
    expect(paths.find(p => p.includes('agent-tokens'))).toBeUndefined();
    expect(paths.find(p => p.includes('agent-registry'))).toBeUndefined();

    // Should have baseline policy, config, profile
    expect(paths).toContain('policies/000-baseline.md');
    expect(paths).toContain('decision-core.config.yaml');
    expect(paths).toContain('decision-core.profile.yaml');
  });

  it('generated baseline policy uses guided posture for personal mode', () => {
    const profile = makePersonalProfile();
    const result = generateArtifacts(profile);
    const baseline = result.artifacts.find(a => a.path === 'policies/000-baseline.md');
    expect(baseline).toBeDefined();
    expect(baseline!.content).toContain('guided');
    expect(baseline!.content).toContain('personal');
  });

  it('policy-pack.yaml has denyUnknownDefault true', () => {
    const profile = makePersonalProfile();
    const result = generateArtifacts(profile);
    const pack = result.artifacts.find(a => a.path === 'policy-pack.yaml');
    expect(pack).toBeDefined();
    const parsed = parseYaml(pack!.content) as Record<string, unknown>;
    expect(parsed.denyUnknownDefault).toBe(true);
  });

  it('generated test scenarios include unknown-action deny case', () => {
    const profile = makePersonalProfile();
    const result = generateArtifacts(profile);
    const scenarios = result.artifacts.find(a => a.path === 'tests/generated-scenarios.json');
    expect(scenarios).toBeDefined();
    const parsed = JSON.parse(scenarios!.content) as Array<{ name: string; expected: string }>;
    const denyCase = parsed.find(s => s.expected === 'deny');
    expect(denyCase).toBeDefined();
  });

  it('no per-agent tokens in personal profile artifacts', () => {
    const profile = makePersonalProfile();
    const result = generateArtifacts(profile);
    const allContent = result.artifacts.map(a => a.content).join('\n');
    expect(allContent).not.toContain('perAgentToken');
    expect(allContent).not.toContain('per-agent-token');
    expect(allContent).not.toContain('agentToken');
  });

  it('personal profile interview answers produce valid profile via applyAllAnswers', () => {
    const profile = createEmptyProfile('personal-apply');
    profile.mode = 'personal';
    const updated = applyAllAnswers(profile, [
      { questionId: 'mode', value: 'personal' },
      { questionId: 'primary_jobs', value: 'code-review, linting' },
    ]);
    expect(updated.mode).toBe('personal');
    expect(updated.userContext.primaryJobs).toEqual(['code-review', 'linting']);
    expect(OnboardingProfileSchema.safeParse(updated).success).toBe(true);
  });
});
