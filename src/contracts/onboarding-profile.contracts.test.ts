import { describe, it, expect } from 'vitest';
import {
  OnboardingProfileModeSchema,
  ONBOARDING_PROFILE_MODES,
  AutonomyPostureSchema,
  AUTONOMY_POSTURES,
  DefaultActionSchema,
  DEFAULT_ACTIONS,
  HarnessTypeSchema,
  HARNESS_TYPES,
  ProfileProviderModeSchema,
  PROVIDER_MODES,
  EvidenceSourceSchema,
  EVIDENCE_SOURCES,
  MemorySourceKindSchema,
  MEMORY_SOURCE_KINDS,
  OnboardingProfileSchema,
  createEmptyProfile,
  getProfileConfidence,
  mergeProfileWithEvidence,
  serializeProfile,
  deserializeProfile,
  redactProfileForReport,
  convertAllAnswersToProfile,
} from './onboarding-profile.contracts.js';
import type { AllAnswers } from './onboarding.contracts.js';

describe('onboarding-profile.contracts', () => {
  // =========================================================================
  // Enum Schemas
  // =========================================================================

  describe('OnboardingProfileModeSchema', () => {
    it('accepts all 4 profile modes', () => {
      expect(ONBOARDING_PROFILE_MODES).toHaveLength(4);
      for (const m of ONBOARDING_PROFILE_MODES) {
        expect(OnboardingProfileModeSchema.parse(m)).toBe(m);
      }
    });

    it('rejects invalid mode', () => {
      expect(() => OnboardingProfileModeSchema.parse('org')).toThrow();
    });
  });

  describe('AutonomyPostureSchema', () => {
    it('accepts all 4 postures', () => {
      expect(AUTONOMY_POSTURES).toHaveLength(4);
      for (const p of AUTONOMY_POSTURES) {
        expect(AutonomyPostureSchema.parse(p)).toBe(p);
      }
    });

    it('rejects invalid posture', () => {
      expect(() => AutonomyPostureSchema.parse('yolo')).toThrow();
    });
  });

  describe('DefaultActionSchema', () => {
    it('accepts all 3 actions', () => {
      expect(DEFAULT_ACTIONS).toHaveLength(3);
      for (const a of DEFAULT_ACTIONS) {
        expect(DefaultActionSchema.parse(a)).toBe(a);
      }
    });
  });

  describe('HarnessTypeSchema', () => {
    it('accepts all 5 harness types', () => {
      expect(HARNESS_TYPES).toHaveLength(5);
      for (const h of HARNESS_TYPES) {
        expect(HarnessTypeSchema.parse(h)).toBe(h);
      }
    });
  });

  describe('ProfileProviderModeSchema', () => {
    it('accepts all 4 provider modes', () => {
      expect(PROVIDER_MODES).toHaveLength(4);
      for (const p of PROVIDER_MODES) {
        expect(ProfileProviderModeSchema.parse(p)).toBe(p);
      }
    });
  });

  describe('EvidenceSourceSchema', () => {
    it('accepts all 5 evidence sources', () => {
      expect(EVIDENCE_SOURCES).toHaveLength(5);
      for (const s of EVIDENCE_SOURCES) {
        expect(EvidenceSourceSchema.parse(s)).toBe(s);
      }
    });
  });

  describe('MemorySourceKindSchema', () => {
    it('accepts all 16 memory source kinds', () => {
      expect(MEMORY_SOURCE_KINDS).toHaveLength(16);
      for (const k of MEMORY_SOURCE_KINDS) {
        expect(MemorySourceKindSchema.parse(k)).toBe(k);
      }
    });

    it('rejects invalid kind', () => {
      expect(() => MemorySourceKindSchema.parse('dropbox')).toThrow();
    });
  });

  // =========================================================================
  // OnboardingProfile Schema
  // =========================================================================

  describe('OnboardingProfileSchema', () => {
    it('validates a minimal personal profile', () => {
      const profile = createEmptyProfile('test-1');
      const result = OnboardingProfileSchema.safeParse(profile);
      expect(result.success).toBe(true);
    });

    it('validates a fully populated business profile', () => {
      const profile = {
        schemaVersion: 1,
        profileId: 'biz-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        mode: 'business',
        agent: {
          harness: 'openclaw',
          harnessVersion: '1.2.0',
          detectedTools: ['file_read', 'shell_exec', 'web_search'],
          detectedCapabilities: ['code_review', 'deployment'],
          configPaths: ['/home/user/.openclaw/config.ts'],
        },
        userContext: {
          description: 'E-commerce operations agent',
          primaryJobs: ['order processing', 'inventory management'],
          domain: 'retail',
          teamName: 'ops-team',
        },
        autonomy: {
          posture: 'balanced',
          defaultAction: 'ask',
          alwaysRequireApproval: ['deploy', 'delete_data'],
          neverAllow: ['drop_database'],
        },
        provider: {
          mode: 'host',
          model: 'claude-sonnet-4-6',
        },
        memory: {
          sources: [
            {
              kind: 'openclaw-native',
              detected: true,
              detectionSignals: ['MEMORY.md found'],
              readConsent: true,
              writeBackConsent: false,
              scope: ['onboarding'],
            },
          ],
          primarySource: 'openclaw-native',
          evidenceImported: true,
        },
        data: {
          classes: ['internal', 'pii', 'financial'],
          handlingObligations: ['encrypt at rest', 'audit all access'],
          complianceFrameworks: ['gdpr', 'pci_dss'],
        },
        tools: [
          {
            name: 'deploy_production',
            description: 'Deploy to production environment',
            riskTier: 4,
            canSpendMoney: false,
            canDeleteData: false,
            canContactPeople: false,
            canPublishContent: true,
            canDeployCode: true,
            accessesSensitiveData: false,
            defaultAction: 'block',
          },
        ],
        surfaces: [
          {
            name: 'operations',
            description: 'Operations surface',
            riskClass: 'B',
            tools: ['deploy_production'],
          },
        ],
        policies: [
          {
            path: '.decision-core/policies/000-baseline.md',
            category: 'baseline',
            generatedAt: '2026-01-01T00:00:00.000Z',
            hash: 'abc123',
          },
        ],
        evidence: [
          {
            source: 'memory',
            sourceId: 'openclaw-native',
            confidence: 0.85,
            sensitive: false,
            collectedAt: '2026-01-01T00:00:00.000Z',
            summary: 'Detected operations-focused agent from MEMORY.md',
          },
        ],
      };

      const result = OnboardingProfileSchema.safeParse(profile);
      expect(result.success).toBe(true);
    });

    it('validates enterprise profile with all compliance frameworks', () => {
      const profile = createEmptyProfile('ent-1');
      profile.mode = 'enterprise';
      profile.autonomy.posture = 'locked_down';
      profile.autonomy.defaultAction = 'block';
      profile.data.complianceFrameworks = ['sox', 'hipaa', 'gdpr'];

      const result = OnboardingProfileSchema.safeParse(profile);
      expect(result.success).toBe(true);
    });

    it('validates team profile', () => {
      const profile = createEmptyProfile('team-1');
      profile.mode = 'team';
      profile.autonomy.posture = 'balanced';

      const result = OnboardingProfileSchema.safeParse(profile);
      expect(result.success).toBe(true);
    });

    it('rejects missing schemaVersion', () => {
      const profile = createEmptyProfile('bad-1');
      const raw = { ...profile, schemaVersion: undefined };
      const result = OnboardingProfileSchema.safeParse(raw);
      expect(result.success).toBe(false);
    });

    it('rejects wrong schemaVersion', () => {
      const profile = createEmptyProfile('bad-2');
      const raw = { ...profile, schemaVersion: 2 };
      const result = OnboardingProfileSchema.safeParse(raw);
      expect(result.success).toBe(false);
    });

    it('rejects invalid tool risk tier', () => {
      const profile = createEmptyProfile('bad-3');
      profile.tools = [
        {
          name: 'test',
          riskTier: 5 as never,
          canSpendMoney: false,
          canDeleteData: false,
          canContactPeople: false,
          canPublishContent: false,
          canDeployCode: false,
          accessesSensitiveData: false,
          defaultAction: 'ask',
        },
      ];
      const result = OnboardingProfileSchema.safeParse(profile);
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // createEmptyProfile
  // =========================================================================

  describe('createEmptyProfile', () => {
    it('creates a valid profile with defaults', () => {
      const profile = createEmptyProfile('new-1');
      expect(profile.profileId).toBe('new-1');
      expect(profile.schemaVersion).toBe(1);
      expect(profile.mode).toBe('personal');
      expect(profile.agent.harness).toBe('unknown');
      expect(profile.autonomy.posture).toBe('guided');
      expect(profile.autonomy.defaultAction).toBe('ask');
      expect(profile.provider.mode).toBe('disabled');
      expect(profile.tools).toEqual([]);
      expect(profile.evidence).toEqual([]);
      expect(profile.memory.sources).toEqual([]);
    });

    it('passes schema validation', () => {
      const profile = createEmptyProfile('valid-1');
      expect(OnboardingProfileSchema.parse(profile)).toBeTruthy();
    });
  });

  // =========================================================================
  // getProfileConfidence
  // =========================================================================

  describe('getProfileConfidence', () => {
    it('returns low confidence for empty profile', () => {
      const profile = createEmptyProfile('conf-1');
      const conf = getProfileConfidence(profile);
      expect(conf.overall).toBeLessThan(0.5);
      expect(conf.weakFields).toContain('userContext.description');
      expect(conf.weakFields).toContain('userContext.primaryJobs');
      expect(conf.weakFields).toContain('agent.harness');
      expect(conf.weakFields).toContain('tools');
      expect(conf.weakFields).toContain('data.classes');
    });

    it('returns higher confidence for populated profile', () => {
      const profile = createEmptyProfile('conf-2');
      profile.agent.harness = 'openclaw';
      profile.userContext.description = 'Test agent';
      profile.userContext.primaryJobs = ['coding'];
      profile.tools = [
        {
          name: 'test',
          riskTier: 1,
          canSpendMoney: false,
          canDeleteData: false,
          canContactPeople: false,
          canPublishContent: false,
          canDeployCode: false,
          accessesSensitiveData: false,
          defaultAction: 'allow',
        },
      ];
      profile.data.classes = ['public'];

      const conf = getProfileConfidence(profile);
      expect(conf.overall).toBe(1.0);
      expect(conf.weakFields).toEqual([]);
    });
  });

  // =========================================================================
  // mergeProfileWithEvidence
  // =========================================================================

  describe('mergeProfileWithEvidence', () => {
    it('merges patch and appends evidence', () => {
      const profile = createEmptyProfile('merge-1');
      const evidence = {
        source: 'memory' as const,
        sourceId: 'gbrain',
        confidence: 0.9,
        sensitive: false,
        collectedAt: '2026-01-01T00:00:00.000Z',
        summary: 'Found business context in G-Brain',
      };

      const merged = mergeProfileWithEvidence(
        profile,
        { mode: 'business' },
        evidence,
      );

      expect(merged.mode).toBe('business');
      expect(merged.profileId).toBe('merge-1');
      expect(merged.createdAt).toBe(profile.createdAt);
      expect(merged.evidence).toHaveLength(1);
      expect(merged.evidence[0].sourceId).toBe('gbrain');
    });

    it('preserves immutable fields', () => {
      const profile = createEmptyProfile('merge-2');
      const evidence = {
        source: 'interview' as const,
        confidence: 1.0,
        sensitive: false,
        collectedAt: '2026-01-01T00:00:00.000Z',
      };

      const merged = mergeProfileWithEvidence(
        profile,
        { profileId: 'hacked', schemaVersion: 1, createdAt: 'hacked' } as never,
        evidence,
      );

      expect(merged.profileId).toBe('merge-2');
      expect(merged.schemaVersion).toBe(1);
      expect(merged.createdAt).toBe(profile.createdAt);
    });

    it('is deterministic for same inputs', () => {
      const profile = createEmptyProfile('merge-3');
      profile.createdAt = '2026-01-01T00:00:00.000Z';
      profile.updatedAt = '2026-01-01T00:00:00.000Z';

      const evidence = {
        source: 'config' as const,
        confidence: 0.7,
        sensitive: false,
        collectedAt: '2026-01-02T00:00:00.000Z',
      };

      const a = mergeProfileWithEvidence(profile, { mode: 'team' }, evidence);
      const b = mergeProfileWithEvidence(profile, { mode: 'team' }, evidence);

      expect(a.mode).toBe(b.mode);
      expect(a.evidence).toEqual(b.evidence);
    });
  });

  // =========================================================================
  // Serialization Round-Trip
  // =========================================================================

  describe('serializeProfile / deserializeProfile', () => {
    it('round-trips a profile preserving all fields', () => {
      const original = createEmptyProfile('rt-1');
      original.mode = 'business';
      original.agent.harness = 'hermes';
      original.tools = [
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
      original.evidence = [
        {
          source: 'memory',
          confidence: 0.8,
          sensitive: false,
          collectedAt: '2026-01-01T00:00:00.000Z',
          summary: 'test evidence',
        },
      ];

      const json = serializeProfile(original);
      const restored = deserializeProfile(json);

      expect(restored.profileId).toBe(original.profileId);
      expect(restored.mode).toBe(original.mode);
      expect(restored.agent.harness).toBe(original.agent.harness);
      expect(restored.tools).toEqual(original.tools);
      expect(restored.evidence).toEqual(original.evidence);
    });

    it('rejects invalid JSON', () => {
      expect(() => deserializeProfile('{')).toThrow();
    });

    it('rejects structurally invalid profile', () => {
      expect(() => deserializeProfile('{"schemaVersion": 2}')).toThrow();
    });
  });

  // =========================================================================
  // redactProfileForReport
  // =========================================================================

  describe('redactProfileForReport', () => {
    it('redacts provider env var name', () => {
      const profile = createEmptyProfile('redact-1');
      profile.provider.envVarName = 'ANTHROPIC_API_KEY';
      profile.provider.localEndpoint = 'http://localhost:11434';

      const redacted = redactProfileForReport(profile);
      expect(redacted.provider.envVarName).toBe('[REDACTED]');
      expect(redacted.provider.localEndpoint).toBe('[REDACTED]');
    });

    it('redacts sensitive evidence', () => {
      const profile = createEmptyProfile('redact-2');
      profile.evidence = [
        {
          source: 'memory',
          sourceId: 'gbrain-private',
          confidence: 0.9,
          sensitive: true,
          collectedAt: '2026-01-01T00:00:00.000Z',
          summary: 'Contains private business data',
        },
        {
          source: 'interview',
          confidence: 1.0,
          sensitive: false,
          collectedAt: '2026-01-01T00:00:00.000Z',
          summary: 'Public answer',
        },
      ];

      const redacted = redactProfileForReport(profile);
      expect(redacted.evidence[0].summary).toBe('[REDACTED]');
      expect(redacted.evidence[0].sourceId).toBe('[REDACTED]');
      expect(redacted.evidence[1].summary).toBe('Public answer');
    });

    it('does not mutate original', () => {
      const profile = createEmptyProfile('redact-3');
      profile.provider.envVarName = 'MY_KEY';

      const redacted = redactProfileForReport(profile);
      expect(redacted.provider.envVarName).toBe('[REDACTED]');
      expect(profile.provider.envVarName).toBe('MY_KEY');
    });
  });

  // =========================================================================
  // convertAllAnswersToProfile
  // =========================================================================

  describe('convertAllAnswersToProfile', () => {
    const sampleAnswers: AllAnswers = {
      phase1: {
        agentDescription: 'A coding assistant for web development',
        agentTools: ['file_read', 'file_write', 'shell_exec'],
        dataAccess: ['source_code', 'internal_docs'],
        environment: 'local_dev',
      },
      phase2: {
        highRiskTools: ['shell_exec'],
        mediumRiskTools: ['file_write'],
        externalServices: false,
        canSpendMoney: false,
        piiHandling: false,
      },
      phase3: {
        riskProfile: 'personal',
        teamSize: 'solo',
        complianceRequirements: ['none'],
        approvalWorkflow: 'approve',
      },
      phase4: {
        providerMode: 'host',
      },
    };

    it('converts personal answers to valid profile', () => {
      const profile = convertAllAnswersToProfile(sampleAnswers, 'convert-1');

      expect(profile.profileId).toBe('convert-1');
      expect(profile.schemaVersion).toBe(1);
      expect(profile.mode).toBe('personal');
      expect(profile.agent.detectedTools).toEqual(['file_read', 'file_write', 'shell_exec']);
      expect(profile.userContext.description).toBe('A coding assistant for web development');
      expect(profile.autonomy.posture).toBe('guided');
      expect(profile.autonomy.alwaysRequireApproval).toContain('shell_exec');
      expect(profile.provider.mode).toBe('host');
      expect(profile.data.classes).toContain('internal');

      const result = OnboardingProfileSchema.safeParse(profile);
      expect(result.success).toBe(true);
    });

    it('converts enterprise answers correctly', () => {
      const entAnswers: AllAnswers = {
        ...sampleAnswers,
        phase2: {
          ...sampleAnswers.phase2,
          piiHandling: true,
          canSpendMoney: true,
        },
        phase3: {
          riskProfile: 'enterprise',
          teamSize: 'large',
          complianceRequirements: ['gdpr', 'hipaa'],
          approvalWorkflow: 'block',
        },
      };

      const profile = convertAllAnswersToProfile(entAnswers, 'convert-2');
      expect(profile.mode).toBe('enterprise');
      expect(profile.autonomy.posture).toBe('locked_down');
      expect(profile.autonomy.defaultAction).toBe('block');
      expect(profile.data.complianceFrameworks).toContain('gdpr');
      expect(profile.data.complianceFrameworks).toContain('hipaa');
      expect(profile.data.complianceFrameworks).not.toContain('none');

      const result = OnboardingProfileSchema.safeParse(profile);
      expect(result.success).toBe(true);
    });

    it('maps data access types to data classes', () => {
      const piiAnswers: AllAnswers = {
        ...sampleAnswers,
        phase1: {
          ...sampleAnswers.phase1,
          dataAccess: ['user_pii', 'financial_records', 'credentials', 'public_data'],
        },
      };

      const profile = convertAllAnswersToProfile(piiAnswers, 'convert-3');
      expect(profile.data.classes).toContain('pii');
      expect(profile.data.classes).toContain('financial');
      expect(profile.data.classes).toContain('credentials');
      expect(profile.data.classes).toContain('public');
    });

    it('includes conversion evidence', () => {
      const profile = convertAllAnswersToProfile(sampleAnswers, 'convert-4');
      expect(profile.evidence).toHaveLength(1);
      expect(profile.evidence[0].source).toBe('interview');
      expect(profile.evidence[0].confidence).toBe(1.0);
    });

    it('deduplicates data classes', () => {
      const dupAnswers: AllAnswers = {
        ...sampleAnswers,
        phase1: {
          ...sampleAnswers.phase1,
          dataAccess: ['source_code', 'internal_docs'],
        },
      };

      const profile = convertAllAnswersToProfile(dupAnswers, 'convert-5');
      const internalCount = profile.data.classes.filter((c) => c === 'internal').length;
      expect(internalCount).toBe(1);
    });
  });
});
