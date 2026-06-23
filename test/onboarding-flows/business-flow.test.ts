/**
 * Business Onboarding Flow Tests
 *
 * Proves:
 *  - A business single-agent path creates appropriate business policy.
 *  - No per-agent tokens are required.
 *  - Business-level tool classification and risk defaults apply.
 *  - Profile-based flow produces valid artifacts with team/business rules.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  OnboardingService,
  generatePoliciesYaml,
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
import { applyModeDefaults, applyAllAnswers } from '../../src/onboarding/interview-engine.js';
import { generateArtifacts } from '../../src/onboarding/generate-artifacts.js';

// ===========================================================================
// Helpers
// ===========================================================================

function makeBusinessAnswers(): AllAnswers {
  return {
    phase1: {
      agentDescription: 'Finance operations assistant',
      agentTools: ['finance-report-read', 'finance-summary-read', 'finance-budget-update'],
      dataAccess: ['financial_records', 'internal_docs'],
      environment: 'staging',
    },
    phase2: {
      highRiskTools: ['finance-budget-update'],
      mediumRiskTools: ['finance-report-read'],
      externalServices: false,
      canSpendMoney: false,
      piiHandling: false,
    },
    phase3: {
      riskProfile: 'team',
      teamSize: 'small',
      complianceRequirements: ['internal_policy'],
      approvalWorkflow: 'approve',
    },
    phase4: {
      providerMode: 'host',
    },
  };
}

function makeBusinessProfile(): OnboardingProfile {
  const profile = createEmptyProfile('business-test');
  return {
    ...profile,
    mode: 'business',
    agent: {
      harness: 'openclaw',
      detectedTools: ['finance-report-read', 'finance-summary-read', 'finance-budget-update'],
      detectedCapabilities: [],
      configPaths: [],
    },
    userContext: {
      description: 'Finance operations assistant',
      primaryJobs: ['financial-reporting', 'budget-management'],
      domain: 'finance',
    },
    autonomy: {
      posture: 'guided',
      defaultAction: 'ask',
      alwaysRequireApproval: ['finance-budget-update'],
      neverAllow: [],
    },
    provider: { mode: 'host' },
    data: {
      classes: ['financial', 'internal'],
      handlingObligations: [],
      complianceFrameworks: ['internal_policy'],
    },
    tools: [
      {
        name: 'finance-report-read',
        riskTier: 2,
        canSpendMoney: false,
        canDeleteData: false,
        canContactPeople: false,
        canPublishContent: false,
        canDeployCode: false,
        accessesSensitiveData: true,
        defaultAction: 'ask',
      },
      {
        name: 'finance-summary-read',
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
        name: 'finance-budget-update',
        riskTier: 3,
        canSpendMoney: true,
        canDeleteData: false,
        canContactPeople: false,
        canPublishContent: false,
        canDeployCode: false,
        accessesSensitiveData: true,
        defaultAction: 'block',
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

describe('onboarding: business flow (legacy interview)', () => {
  let service: OnboardingService;

  beforeEach(() => {
    service = new OnboardingService();
  });

  it('completes the 4-phase interview and produces a team-profile result', () => {
    const answers = makeBusinessAnswers();
    const { sessionId } = service.startOnboarding('tenant-biz');

    service.processPhaseAnswers(sessionId, 1, answers.phase1);
    service.processPhaseAnswers(sessionId, 2, answers.phase2);
    service.processPhaseAnswers(sessionId, 3, answers.phase3);
    const r4 = service.processPhaseAnswers(sessionId, 4, answers.phase4);

    expect(r4.result).toBeDefined();
    expect(r4.result!.riskProfile).toBe('team');
    expect(r4.result!.providerMode).toBe('host');
  });

  it('classifies tools into high, medium, and low risk', () => {
    const answers = makeBusinessAnswers();
    const tools = classifyTools(answers);
    expect(tools).toHaveLength(3);

    const high = tools.find(t => t.name === 'finance-budget-update');
    const medium = tools.find(t => t.name === 'finance-report-read');
    const low = tools.find(t => t.name === 'finance-summary-read');

    expect(high?.riskClass).toBe('high');
    expect(medium?.riskClass).toBe('medium');
    expect(low?.riskClass).toBe('low');
  });

  it('generates policies with approval for high-risk tools', () => {
    const answers = makeBusinessAnswers();
    const yaml = generatePoliciesYaml(answers);
    const parsed = parseYaml(yaml) as { rules: Array<Record<string, unknown>> };

    const highRiskRule = parsed.rules.find(r => r.actionTypePattern === 'finance-budget-update');
    expect(highRiskRule).toBeDefined();
    expect(highRiskRule!.riskClass).toBe('A');
    expect(highRiskRule!.requireApproval).toBe(true);
  });

  it('does not require per-agent tokens', () => {
    const answers = makeBusinessAnswers();
    const config = generateAllConfig(answers);
    const allContent = config.policies + config.surfaces + config.provider;
    expect(allContent).not.toContain('perAgentToken');
    expect(allContent).not.toContain('per_agent_token');
    expect(allContent).not.toContain('agent_token');
  });

  it('includes compliance audit rule for internal_policy', () => {
    const answers = makeBusinessAnswers();
    const yaml = generatePoliciesYaml(answers);
    const parsed = parseYaml(yaml) as { rules: Array<Record<string, unknown>> };

    const complianceRule = parsed.rules.find(r =>
      typeof r.name === 'string' && r.name.includes('Compliance'),
    );
    expect(complianceRule).toBeDefined();
    expect(complianceRule!.policyType).toBe('compliance');
  });

  it('validates generated config without errors', () => {
    const answers = makeBusinessAnswers();
    const config = generateAllConfig(answers);
    const result = validateGeneratedConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ===========================================================================
// Profile-based flow
// ===========================================================================

describe('onboarding: business flow (profile-based)', () => {
  it('business profile validates against OnboardingProfileSchema', () => {
    const profile = makeBusinessProfile();
    const result = OnboardingProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it('mode defaults apply guided posture for business', () => {
    const profile = createEmptyProfile('biz-defaults');
    profile.mode = 'business';
    const updated = applyModeDefaults(profile);
    expect(updated.autonomy.posture).toBe('guided');
    expect(updated.autonomy.defaultAction).toBe('ask');
    expect(updated.provider.mode).toBe('host');
  });

  it('generates artifacts with team-level destructive-approval rule', () => {
    const profile = makeBusinessProfile();
    const result = generateArtifacts(profile);
    const pack = result.artifacts.find(a => a.path === 'policy-pack.yaml');
    expect(pack).toBeDefined();
    const parsed = parseYaml(pack!.content) as { rules: Array<Record<string, unknown>> };

    const destructiveRule = parsed.rules.find(r => r.name === 'team-destructive-approval');
    expect(destructiveRule).toBeDefined();
    expect(destructiveRule!.requireApproval).toBe(true);
  });

  it('no per-agent tokens in business profile artifacts', () => {
    const profile = makeBusinessProfile();
    const result = generateArtifacts(profile);
    const allContent = result.artifacts.map(a => a.content).join('\n');
    expect(allContent).not.toContain('perAgentToken');
    expect(allContent).not.toContain('per-agent-token');
    expect(allContent).not.toContain('agentToken');
  });

  it('high-risk tool gets approval-required or deny in policy-pack', () => {
    const profile = makeBusinessProfile();
    const result = generateArtifacts(profile);
    const pack = result.artifacts.find(a => a.path === 'policy-pack.yaml');
    expect(pack).toBeDefined();
    const parsed = parseYaml(pack!.content) as { rules: Array<Record<string, unknown>> };

    const budgetRule = parsed.rules.find(r =>
      r.actionTypePattern === 'finance-budget-update',
    );
    expect(budgetRule).toBeDefined();
    // risk tier 3 → approve_required
    expect(budgetRule!.requireApproval).toBe(true);
  });

  it('generated artifacts have denyUnknownDefault enabled', () => {
    const profile = makeBusinessProfile();
    const result = generateArtifacts(profile);
    const pack = result.artifacts.find(a => a.path === 'policy-pack.yaml');
    expect(pack).toBeDefined();
    const parsed = parseYaml(pack!.content) as Record<string, unknown>;
    expect(parsed.denyUnknownDefault).toBe(true);
  });

  it('business profile produces tools policy with finance surface', () => {
    const profile = makeBusinessProfile();
    const result = generateArtifacts(profile);
    const toolsPolicy = result.artifacts.find(a => a.path === 'policies/010-tools.md');
    expect(toolsPolicy).toBeDefined();
    expect(toolsPolicy!.content).toContain('finance');
  });

  it('business interview answers produce valid profile via applyAllAnswers', () => {
    const profile = createEmptyProfile('biz-apply');
    profile.mode = 'business';
    const updated = applyAllAnswers(profile, [
      { questionId: 'mode', value: 'business' },
      { questionId: 'primary_jobs', value: 'financial-reporting, budget-management' },
      { questionId: 'destructive_tools', value: 'finance-budget-update' },
      { questionId: 'high_risk_capabilities', value: ['spend_money', 'access_sensitive_data'] },
      { questionId: 'always_approve', value: 'finance-budget-update' },
    ]);

    expect(updated.mode).toBe('business');
    expect(updated.tools.length).toBeGreaterThan(0);
    expect(updated.tools[0].canSpendMoney).toBe(true);
    expect(updated.autonomy.alwaysRequireApproval).toContain('finance-budget-update');
    expect(OnboardingProfileSchema.safeParse(updated).success).toBe(true);
  });

  it('no org-level artifacts (no agent registry or provision guidance)', () => {
    const profile = makeBusinessProfile();
    const result = generateArtifacts(profile);
    const paths = result.artifacts.map(a => a.path);

    expect(paths.find(p => p.includes('agent-registry'))).toBeUndefined();
    expect(paths.find(p => p.includes('access-policy'))).toBeUndefined();
    expect(paths.find(p => p.includes('provision'))).toBeUndefined();

    const allContent = result.artifacts.map(a => a.content).join('\n');
    expect(allContent).not.toContain('agent-registry');
  });
});
