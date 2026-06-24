/**
 * Onboarding Profile Contracts
 *
 * Canonical evidence-backed profile schema for agent-led setup.
 * Coexists with AllAnswers from onboarding.contracts.ts for backward compatibility.
 */

import { z } from 'zod';
import type { AllAnswers } from './onboarding.contracts.js';

// ===========================================================================
// Enums
// ===========================================================================

export const ONBOARDING_PROFILE_MODES = ['personal', 'team', 'business', 'enterprise'] as const;
export const OnboardingProfileModeSchema = z.enum(ONBOARDING_PROFILE_MODES);
export type OnboardingProfileMode = z.infer<typeof OnboardingProfileModeSchema>;

export const AUTONOMY_POSTURES = ['locked_down', 'guided', 'balanced', 'high_autonomy'] as const;
export const AutonomyPostureSchema = z.enum(AUTONOMY_POSTURES);
export type AutonomyPosture = z.infer<typeof AutonomyPostureSchema>;

export const DEFAULT_ACTIONS = ['block', 'ask', 'allow'] as const;
export const DefaultActionSchema = z.enum(DEFAULT_ACTIONS);
export type DefaultAction = z.infer<typeof DefaultActionSchema>;

export const HARNESS_TYPES = ['openclaw', 'hermes', 'generic', 'standalone', 'unknown'] as const;
export const HarnessTypeSchema = z.enum(HARNESS_TYPES);
export type HarnessType = z.infer<typeof HarnessTypeSchema>;

export const PROVIDER_MODES = ['host', 'disabled', 'direct', 'local'] as const;
export const ProfileProviderModeSchema = z.enum(PROVIDER_MODES);
export type ProfileProviderMode = z.infer<typeof ProfileProviderModeSchema>;

export const EVIDENCE_SOURCES = ['interview', 'config', 'memory', 'repository', 'user'] as const;
export const EvidenceSourceSchema = z.enum(EVIDENCE_SOURCES);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export const MEMORY_SOURCE_KINDS = [
  'gbrain',
  'mempalace',
  'openclaw-native',
  'hermes-built-in',
  'hermes-active-provider',
  'markdown-vault',
  'obsidian-mcp',
  'mem0',
  'honcho',
  'zep-graphiti',
  'supermemory',
  'cognee',
  'letta',
  'langmem',
  'generic-mcp',
  'none',
] as const;
export const MemorySourceKindSchema = z.enum(MEMORY_SOURCE_KINDS);
export type MemorySourceKind = z.infer<typeof MemorySourceKindSchema>;

export const TOOL_RISK_TIERS = [1, 2, 3, 4] as const;
export const ToolRiskTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type ToolRiskTier = z.infer<typeof ToolRiskTierSchema>;

// ===========================================================================
// Evidence Wrapper
// ===========================================================================

export const ProfileEvidenceSchema = z.object({
  source: EvidenceSourceSchema,
  sourceId: z.string().optional(),
  confidence: z.number().min(0).max(1),
  sensitive: z.boolean().default(false),
  collectedAt: z.string(),
  summary: z.string().optional(),
});
export type ProfileEvidence = z.infer<typeof ProfileEvidenceSchema>;

// Helper: wrap a value with evidence metadata
export const EvidencedFieldSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema,
    evidence: z.array(ProfileEvidenceSchema).default([]),
  });

// ===========================================================================
// Agent Context
// ===========================================================================

export const AgentContextSchema = z.object({
  harness: HarnessTypeSchema,
  harnessVersion: z.string().optional(),
  detectedTools: z.array(z.string()).default([]),
  detectedCapabilities: z.array(z.string()).default([]),
  configPaths: z.array(z.string()).default([]),
});
export type AgentContext = z.infer<typeof AgentContextSchema>;

// ===========================================================================
// User Context
// ===========================================================================

export const UserContextSchema = z.object({
  description: z.string().optional(),
  primaryJobs: z.array(z.string()).default([]),
  domain: z.string().optional(),
  teamName: z.string().optional(),
});
export type UserContext = z.infer<typeof UserContextSchema>;

// ===========================================================================
// Autonomy Config
// ===========================================================================

export const ProfileAutonomyConfigSchema = z.object({
  posture: AutonomyPostureSchema,
  defaultAction: DefaultActionSchema,
  alwaysRequireApproval: z.array(z.string()).default([]),
  neverAllow: z.array(z.string()).default([]),
  // Non-breaking onboarding posture: a fresh install runs in 'observe' (records
  // would-be denials, blocks nothing) so existing tools keep working; the
  // operator reviews impact, then flips to 'enforce'. Enterprise defaults enforce.
  enforcementMode: z.enum(['enforce', 'observe']).default('observe'),
});
export type ProfileAutonomyConfig = z.infer<typeof ProfileAutonomyConfigSchema>;

// ===========================================================================
// Provider Config
// ===========================================================================

export const ProfileProviderConfigSchema = z.object({
  mode: ProfileProviderModeSchema,
  envVarName: z.string().optional(),
  localEndpoint: z.string().optional(),
  model: z.string().optional(),
});
export type ProfileProviderConfig = z.infer<typeof ProfileProviderConfigSchema>;

// ===========================================================================
// Memory Source Detection
// ===========================================================================

export const MemorySourceDetectionSchema = z.object({
  kind: MemorySourceKindSchema,
  detected: z.boolean(),
  detectionSignals: z.array(z.string()).default([]),
  readConsent: z.boolean().default(false),
  writeBackConsent: z.boolean().default(false),
  scope: z.array(z.string()).default([]),
});
export type MemorySourceDetection = z.infer<typeof MemorySourceDetectionSchema>;

export const MemoryConfigSchema = z.object({
  sources: z.array(MemorySourceDetectionSchema).default([]),
  primarySource: MemorySourceKindSchema.optional(),
  evidenceImported: z.boolean().default(false),
});
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

// ===========================================================================
// Tool Declaration
// ===========================================================================

export const ProfileToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  riskTier: ToolRiskTierSchema,
  canSpendMoney: z.boolean().default(false),
  canDeleteData: z.boolean().default(false),
  canContactPeople: z.boolean().default(false),
  canPublishContent: z.boolean().default(false),
  canDeployCode: z.boolean().default(false),
  accessesSensitiveData: z.boolean().default(false),
  defaultAction: DefaultActionSchema,
});
export type ProfileTool = z.infer<typeof ProfileToolSchema>;

// ===========================================================================
// Data Classification
// ===========================================================================

export const DATA_CLASSES = [
  'public',
  'internal',
  'confidential',
  'restricted',
  'pii',
  'financial',
  'credentials',
  'health',
  'legal',
] as const;
export const DataClassSchema = z.enum(DATA_CLASSES);
export type DataClass = z.infer<typeof DataClassSchema>;

export const DataClassificationSchema = z.object({
  classes: z.array(DataClassSchema).default([]),
  handlingObligations: z.array(z.string()).default([]),
  complianceFrameworks: z.array(z.string()).default([]),
});
export type DataClassification = z.infer<typeof DataClassificationSchema>;

// ===========================================================================
// Surface Declaration
// ===========================================================================

export const ProfileSurfaceSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  riskClass: z.enum(['A', 'B', 'C']),
  tools: z.array(z.string()).default([]),
});
export type ProfileSurface = z.infer<typeof ProfileSurfaceSchema>;

// ===========================================================================
// Generated Policy Reference
// ===========================================================================

export const GeneratedPolicyRefSchema = z.object({
  path: z.string(),
  category: z.string(),
  generatedAt: z.string(),
  hash: z.string().optional(),
});
export type GeneratedPolicyRef = z.infer<typeof GeneratedPolicyRefSchema>;

// ===========================================================================
// Onboarding Profile (top-level)
// ===========================================================================

export const OnboardingProfileSchema = z.object({
  schemaVersion: z.literal(1),
  profileId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),

  mode: OnboardingProfileModeSchema,
  agent: AgentContextSchema,
  userContext: UserContextSchema,
  autonomy: ProfileAutonomyConfigSchema,
  provider: ProfileProviderConfigSchema,
  memory: MemoryConfigSchema,
  data: DataClassificationSchema,

  tools: z.array(ProfileToolSchema).default([]),
  surfaces: z.array(ProfileSurfaceSchema).default([]),
  policies: z.array(GeneratedPolicyRefSchema).default([]),

  evidence: z.array(ProfileEvidenceSchema).default([]),

  activatedAt: z.string().optional(),
});
export type OnboardingProfile = z.infer<typeof OnboardingProfileSchema>;

// ===========================================================================
// Helpers
// ===========================================================================

export function createEmptyProfile(profileId: string): OnboardingProfile {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    profileId,
    createdAt: now,
    updatedAt: now,
    mode: 'personal',
    agent: {
      harness: 'unknown',
      detectedTools: [],
      detectedCapabilities: [],
      configPaths: [],
    },
    userContext: {
      primaryJobs: [],
    },
    autonomy: {
      posture: 'guided',
      defaultAction: 'ask',
      enforcementMode: 'observe',
      alwaysRequireApproval: [],
      neverAllow: [],
    },
    provider: {
      mode: 'disabled',
    },
    memory: {
      sources: [],
      evidenceImported: false,
    },
    data: {
      classes: [],
      handlingObligations: [],
      complianceFrameworks: [],
    },
    tools: [],
    surfaces: [],
    policies: [],
    evidence: [],
  };
}

export function getProfileConfidence(profile: OnboardingProfile): {
  overall: number;
  fieldCount: number;
  evidencedFieldCount: number;
  weakFields: string[];
} {
  const checks: { field: string; filled: boolean }[] = [
    { field: 'mode', filled: true },
    { field: 'agent.harness', filled: profile.agent.harness !== 'unknown' },
    { field: 'userContext.description', filled: !!profile.userContext.description },
    { field: 'userContext.primaryJobs', filled: profile.userContext.primaryJobs.length > 0 },
    { field: 'autonomy.posture', filled: true },
    { field: 'provider.mode', filled: true },
    { field: 'tools', filled: profile.tools.length > 0 },
    { field: 'data.classes', filled: profile.data.classes.length > 0 },
  ];

  const fieldCount = checks.length;
  const evidencedFieldCount = checks.filter((c) => c.filled).length;
  const weakFields = checks.filter((c) => !c.filled).map((c) => c.field);
  const overall = fieldCount > 0 ? evidencedFieldCount / fieldCount : 0;

  return { overall, fieldCount, evidencedFieldCount, weakFields };
}

export function mergeProfileWithEvidence(
  profile: OnboardingProfile,
  patch: Partial<OnboardingProfile>,
  evidence: ProfileEvidence,
): OnboardingProfile {
  const now = new Date().toISOString();
  return {
    ...profile,
    ...patch,
    schemaVersion: 1,
    profileId: profile.profileId,
    createdAt: profile.createdAt,
    updatedAt: now,
    evidence: [...profile.evidence, evidence],
  };
}

export function serializeProfile(profile: OnboardingProfile): string {
  return JSON.stringify(profile, null, 2);
}

export function deserializeProfile(json: string): OnboardingProfile {
  return OnboardingProfileSchema.parse(JSON.parse(json));
}

export function redactProfileForReport(profile: OnboardingProfile): OnboardingProfile {
  return {
    ...profile,
    provider: {
      ...profile.provider,
      envVarName: profile.provider.envVarName ? '[REDACTED]' : undefined,
      localEndpoint: profile.provider.localEndpoint ? '[REDACTED]' : undefined,
    },
    evidence: profile.evidence.map((e) =>
      e.sensitive ? { ...e, summary: '[REDACTED]', sourceId: e.sourceId ? '[REDACTED]' : undefined } : e,
    ),
  };
}

export function convertAllAnswersToProfile(
  answers: AllAnswers,
  profileId: string,
): OnboardingProfile {
  const now = new Date().toISOString();
  const evidence: ProfileEvidence = {
    source: 'interview',
    confidence: 1.0,
    sensitive: false,
    collectedAt: now,
    summary: 'Converted from legacy AllAnswers onboarding flow',
  };

  const modeMap: Record<string, OnboardingProfileMode> = {
    personal: 'personal',
    team: 'team',
    enterprise: 'enterprise',
  };

  const allTools = [
    ...answers.phase2.highRiskTools.map((name) => ({
      name,
      riskTier: 4 as const,
      canSpendMoney: answers.phase2.canSpendMoney,
      canDeleteData: false,
      canContactPeople: false,
      canPublishContent: false,
      canDeployCode: false,
      accessesSensitiveData: answers.phase2.piiHandling,
      defaultAction: 'block' as const,
    })),
    ...answers.phase2.mediumRiskTools.map((name) => ({
      name,
      riskTier: 2 as const,
      canSpendMoney: false,
      canDeleteData: false,
      canContactPeople: false,
      canPublishContent: false,
      canDeployCode: false,
      accessesSensitiveData: false,
      defaultAction: 'ask' as const,
    })),
  ];

  const dataClasses: DataClass[] = [];
  for (const da of answers.phase1.dataAccess) {
    if (da === 'user_pii') dataClasses.push('pii');
    if (da === 'financial_records') dataClasses.push('financial');
    if (da === 'credentials') dataClasses.push('credentials');
    if (da === 'internal_docs') dataClasses.push('internal');
    if (da === 'source_code') dataClasses.push('internal');
    if (da === 'public_data') dataClasses.push('public');
  }

  const postureMap: Record<string, AutonomyPosture> = {
    block: 'locked_down',
    approve: 'guided',
    log_only: 'high_autonomy',
  };

  return {
    schemaVersion: 1,
    profileId,
    createdAt: now,
    updatedAt: now,
    mode: modeMap[answers.phase3.riskProfile] ?? 'personal',
    agent: {
      harness: 'unknown',
      detectedTools: answers.phase1.agentTools,
      detectedCapabilities: [],
      configPaths: [],
    },
    userContext: {
      description: answers.phase1.agentDescription,
      primaryJobs: [],
    },
    autonomy: {
      posture: postureMap[answers.phase3.approvalWorkflow] ?? 'guided',
      defaultAction: answers.phase3.approvalWorkflow === 'block' ? 'block' : 'ask',
      // Observe-first by default; applyModeDefaults() upgrades enterprise to enforce.
      enforcementMode: 'observe',
      alwaysRequireApproval: answers.phase2.highRiskTools,
      neverAllow: [],
    },
    provider: {
      mode: answers.phase4.providerMode,
      envVarName: answers.phase4.apiKeyEnvVar,
      localEndpoint: answers.phase4.localEndpoint,
    },
    memory: {
      sources: [],
      evidenceImported: false,
    },
    data: {
      classes: [...new Set(dataClasses)],
      handlingObligations: [],
      complianceFrameworks: answers.phase3.complianceRequirements.filter((c) => c !== 'none'),
    },
    tools: allTools,
    surfaces: [],
    policies: [],
    evidence: [evidence],
  };
}
