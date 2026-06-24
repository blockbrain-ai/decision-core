import { describe, it, expect } from 'vitest';
import {
  planInterview,
  applyAnswer,
  applyModeDefaults,
  applyAllAnswers,
  getModeDefaults,
} from './interview-engine.js';
import { createEmptyProfile } from '../contracts/onboarding-profile.contracts.js';
import type { OnboardingProfile } from '../contracts/onboarding-profile.contracts.js';

function populatedProfile(): OnboardingProfile {
  const p = createEmptyProfile('pop-1');
  p.agent.harness = 'openclaw';
  p.userContext.primaryJobs = ['code review', 'deployment'];
  p.tools = [
    {
      name: 'deploy',
      riskTier: 4,
      canSpendMoney: false,
      canDeleteData: false,
      canContactPeople: false,
      canPublishContent: false,
      canDeployCode: true,
      accessesSensitiveData: false,
      defaultAction: 'block',
    },
  ];
  p.provider.mode = 'host';
  p.memory.sources = [
    { kind: 'openclaw-native', detected: true, detectionSignals: ['MEMORY.md'], readConsent: true, writeBackConsent: false, scope: ['onboarding'] },
  ];
  return p;
}

describe('interview-engine', () => {
  describe('getModeDefaults', () => {
    it('returns guided for personal', () => {
      const d = getModeDefaults('personal');
      expect(d.posture).toBe('guided');
      expect(d.defaultAction).toBe('ask');
    });

    it('returns locked_down for enterprise', () => {
      const d = getModeDefaults('enterprise');
      expect(d.posture).toBe('locked_down');
      expect(d.defaultAction).toBe('block');
    });
  });

  describe('planInterview', () => {
    it('plans full interview for empty profile', () => {
      const profile = createEmptyProfile('plan-1');
      const plan = planInterview(profile);
      expect(plan.questions.length).toBeGreaterThan(5);
      expect(plan.reason).toContain('full interview');
    });

    it('plans fewer questions for populated profile', () => {
      const profile = populatedProfile();
      const plan = planInterview(profile);
      expect(plan.questions.length).toBeLessThan(planInterview(createEmptyProfile('x')).questions.length);
      expect(plan.skippedCount).toBeGreaterThan(0);
    });

    it('skips harness question when detected', () => {
      const profile = createEmptyProfile('plan-2');
      profile.agent.harness = 'hermes';
      const plan = planInterview(profile);
      const harnessQ = plan.questions.find((q) => q.id === 'harness');
      expect(harnessQ).toBeUndefined();
    });

    it('asks harness question when unknown', () => {
      const profile = createEmptyProfile('plan-3');
      const plan = planInterview(profile);
      const harnessQ = plan.questions.find((q) => q.id === 'harness');
      expect(harnessQ).toBeDefined();
    });

    it('users with strong evidence answer fewer than 5 required questions', () => {
      const profile = populatedProfile();
      const plan = planInterview(profile);
      const requiredCount = plan.questions.filter((q) => q.required).length;
      expect(requiredCount).toBeLessThan(5);
    });
  });

  describe('applyAnswer', () => {
    it('applies mode answer', () => {
      const profile = createEmptyProfile('ans-1');
      const updated = applyAnswer(profile, { questionId: 'mode', value: 'business' });
      expect(updated.mode).toBe('business');
    });

    it('applies harness answer', () => {
      const profile = createEmptyProfile('ans-2');
      const updated = applyAnswer(profile, { questionId: 'harness', value: 'hermes' });
      expect(updated.agent.harness).toBe('hermes');
    });

    it('applies primary jobs as comma-separated', () => {
      const profile = createEmptyProfile('ans-3');
      const updated = applyAnswer(profile, {
        questionId: 'primary_jobs',
        value: 'code review, deployment, monitoring',
      });
      expect(updated.userContext.primaryJobs).toEqual(['code review', 'deployment', 'monitoring']);
    });

    it('applies destructive tools', () => {
      const profile = createEmptyProfile('ans-4');
      const updated = applyAnswer(profile, {
        questionId: 'destructive_tools',
        value: 'deploy, delete_records, send_email',
      });
      expect(updated.tools).toHaveLength(3);
      expect(updated.tools[0].name).toBe('deploy');
      expect(updated.tools[0].riskTier).toBe(3);
    });

    it('applies high risk capabilities to tools', () => {
      let profile = createEmptyProfile('ans-5');
      profile = applyAnswer(profile, { questionId: 'destructive_tools', value: 'deploy' });
      const updated = applyAnswer(profile, {
        questionId: 'high_risk_capabilities',
        value: ['spend_money', 'deploy_code'],
      });
      expect(updated.tools[0].canSpendMoney).toBe(true);
      expect(updated.tools[0].canDeployCode).toBe(true);
      expect(updated.tools[0].riskTier).toBe(4);
      expect(updated.tools[0].defaultAction).toBe('block');
    });

    it('applies provider mode', () => {
      const profile = createEmptyProfile('ans-6');
      const updated = applyAnswer(profile, { questionId: 'provider_mode', value: 'host' });
      expect(updated.provider.mode).toBe('host');
    });

    it('applies memory consent', () => {
      const profile = createEmptyProfile('ans-7');
      profile.memory.sources = [
        { kind: 'gbrain', detected: true, detectionSignals: [], readConsent: false, writeBackConsent: false, scope: [] },
        { kind: 'openclaw-native', detected: true, detectionSignals: [], readConsent: false, writeBackConsent: false, scope: [] },
      ];

      const updated = applyAnswer(profile, {
        questionId: 'memory_consent',
        value: ['gbrain'],
      });
      expect(updated.memory.sources.find((s) => s.kind === 'gbrain')!.readConsent).toBe(true);
      expect(updated.memory.sources.find((s) => s.kind === 'openclaw-native')!.readConsent).toBe(false);
    });

    it('applies writeback consent only to read-consented sources', () => {
      const profile = createEmptyProfile('ans-8');
      profile.memory.sources = [
        { kind: 'gbrain', detected: true, detectionSignals: [], readConsent: true, writeBackConsent: false, scope: [] },
        { kind: 'openclaw-native', detected: true, detectionSignals: [], readConsent: false, writeBackConsent: false, scope: [] },
      ];

      const updated = applyAnswer(profile, { questionId: 'writeback_consent', value: true });
      expect(updated.memory.sources.find((s) => s.kind === 'gbrain')!.writeBackConsent).toBe(true);
      expect(updated.memory.sources.find((s) => s.kind === 'openclaw-native')!.writeBackConsent).toBe(false);
    });
  });

  describe('applyModeDefaults', () => {
    it('applies enterprise defaults', () => {
      const profile = createEmptyProfile('def-1');
      profile.mode = 'enterprise';
      const updated = applyModeDefaults(profile);
      expect(updated.autonomy.posture).toBe('locked_down');
      expect(updated.autonomy.defaultAction).toBe('block');
    });

    it('defaults non-enterprise modes to OBSERVE (non-breaking install) and enterprise to ENFORCE', () => {
      for (const mode of ['personal', 'team', 'business'] as const) {
        const updated = applyModeDefaults(Object.assign(createEmptyProfile('m'), { mode }));
        expect(updated.autonomy.enforcementMode, `${mode} should be observe`).toBe('observe');
      }
      const ent = applyModeDefaults(Object.assign(createEmptyProfile('m'), { mode: 'enterprise' as const }));
      expect(ent.autonomy.enforcementMode).toBe('enforce');
    });

    it('preserves an operator-chosen enforce even for a non-enterprise mode', () => {
      const profile = createEmptyProfile('def-enf');
      profile.mode = 'business';
      profile.autonomy.enforcementMode = 'enforce';
      expect(applyModeDefaults(profile).autonomy.enforcementMode).toBe('enforce');
    });

    it('does not override non-default posture', () => {
      const profile = createEmptyProfile('def-2');
      profile.mode = 'enterprise';
      profile.autonomy.posture = 'balanced';
      const updated = applyModeDefaults(profile);
      expect(updated.autonomy.posture).toBe('balanced');
    });

    it('applies host provider for team mode', () => {
      const profile = createEmptyProfile('def-3');
      profile.mode = 'team';
      const updated = applyModeDefaults(profile);
      expect(updated.provider.mode).toBe('host');
    });
  });

  describe('applyAllAnswers', () => {
    it('applies multiple answers and mode defaults', () => {
      const profile = createEmptyProfile('all-1');
      const updated = applyAllAnswers(profile, [
        { questionId: 'mode', value: 'business' },
        { questionId: 'harness', value: 'openclaw' },
        { questionId: 'primary_jobs', value: 'order processing, inventory' },
        { questionId: 'destructive_tools', value: 'deploy' },
      ]);

      expect(updated.mode).toBe('business');
      expect(updated.agent.harness).toBe('openclaw');
      expect(updated.userContext.primaryJobs).toHaveLength(2);
      expect(updated.tools).toHaveLength(1);
      expect(updated.provider.mode).toBe('host');
    });
  });
});
