/**
 * Onboarding Contracts
 *
 * Zod schemas and types for the 5-phase onboarding interview flow.
 */

import { z } from 'zod';

// ===========================================================================
// Question Types
// ===========================================================================

export const QuestionTypeSchema = z.enum(['text', 'select', 'multi_select', 'confirm']);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const OnboardingQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  type: QuestionTypeSchema,
  options: z.array(z.string()).optional(),
  default: z.string().optional(),
});
export type OnboardingQuestion = z.infer<typeof OnboardingQuestionSchema>;

// ===========================================================================
// Phase Types
// ===========================================================================

export const ONBOARDING_PHASES = [1, 2, 3, 4, 5] as const;
export type PhaseNumber = (typeof ONBOARDING_PHASES)[number];

export const OnboardingPhaseSchema = z.object({
  phase: z.number().int().min(1).max(5),
  title: z.string(),
  questions: z.array(OnboardingQuestionSchema),
  required: z.boolean(),
});
export type OnboardingPhase = z.infer<typeof OnboardingPhaseSchema>;

// ===========================================================================
// Risk & Governance
// ===========================================================================

export const RiskProfileSchema = z.enum(['personal', 'team', 'enterprise']);
export type RiskProfile = z.infer<typeof RiskProfileSchema>;

export const ProviderModeOnboardingSchema = z.enum(['host', 'disabled', 'direct', 'local']);
export type ProviderModeOnboarding = z.infer<typeof ProviderModeOnboardingSchema>;

export const ApprovalWorkflowSchema = z.enum(['block', 'approve', 'log_only']);
export type ApprovalWorkflow = z.infer<typeof ApprovalWorkflowSchema>;

export const DataAccessTypeSchema = z.enum([
  'public_data', 'internal_docs', 'user_pii',
  'financial_records', 'source_code', 'credentials', 'none',
]);
export type DataAccessType = z.infer<typeof DataAccessTypeSchema>;

export const EnvironmentSchema = z.enum(['local_dev', 'staging', 'production', 'ci_cd']);
export type Environment = z.infer<typeof EnvironmentSchema>;

export const ComplianceStandardSchema = z.enum([
  'none', 'sox', 'gdpr', 'hipaa', 'pci_dss', 'iso_27001', 'internal_policy',
]);
export type ComplianceStandard = z.infer<typeof ComplianceStandardSchema>;

export const TeamSizeSchema = z.enum(['solo', 'small', 'large']);
export type TeamSize = z.infer<typeof TeamSizeSchema>;

// ===========================================================================
// Tool Declaration
// ===========================================================================

export const ToolRiskClassSchema = z.enum(['high', 'medium', 'low']);
export type ToolRiskClass = z.infer<typeof ToolRiskClassSchema>;

export const ToolDeclarationSchema = z.object({
  name: z.string(),
  riskClass: ToolRiskClassSchema,
});
export type ToolDeclaration = z.infer<typeof ToolDeclarationSchema>;

// ===========================================================================
// Phase Answers
// ===========================================================================

export const Phase1AnswersSchema = z.object({
  agentDescription: z.string().min(1),
  agentTools: z.array(z.string()).min(1),
  dataAccess: z.array(DataAccessTypeSchema),
  environment: EnvironmentSchema,
});
export type Phase1Answers = z.infer<typeof Phase1AnswersSchema>;

export const Phase2AnswersSchema = z.object({
  highRiskTools: z.array(z.string()),
  mediumRiskTools: z.array(z.string()),
  externalServices: z.boolean(),
  canSpendMoney: z.boolean(),
  piiHandling: z.boolean(),
});
export type Phase2Answers = z.infer<typeof Phase2AnswersSchema>;

export const Phase3AnswersSchema = z.object({
  riskProfile: RiskProfileSchema,
  teamSize: TeamSizeSchema,
  complianceRequirements: z.array(ComplianceStandardSchema),
  approvalWorkflow: ApprovalWorkflowSchema,
});
export type Phase3Answers = z.infer<typeof Phase3AnswersSchema>;

export const Phase4AnswersSchema = z.object({
  providerMode: ProviderModeOnboardingSchema,
  apiKeyEnvVar: z.string().optional(),
  localEndpoint: z.string().optional(),
});
export type Phase4Answers = z.infer<typeof Phase4AnswersSchema>;

// ===========================================================================
// Collected Answers & Result
// ===========================================================================

export const AllAnswersSchema = z.object({
  phase1: Phase1AnswersSchema,
  phase2: Phase2AnswersSchema,
  phase3: Phase3AnswersSchema,
  phase4: Phase4AnswersSchema,
});
export type AllAnswers = z.infer<typeof AllAnswersSchema>;

export const GeneratedConfigSchema = z.object({
  policies: z.string(),
  surfaces: z.string(),
  provider: z.string(),
});
export type GeneratedConfig = z.infer<typeof GeneratedConfigSchema>;

export const OnboardingResultSchema = z.object({
  agentDescription: z.string(),
  tools: z.array(ToolDeclarationSchema),
  riskProfile: RiskProfileSchema,
  providerMode: ProviderModeOnboardingSchema,
  generatedConfig: GeneratedConfigSchema,
});
export type OnboardingResult = z.infer<typeof OnboardingResultSchema>;

// ===========================================================================
// Session State
// ===========================================================================

export const OnboardingSessionSchema = z.object({
  sessionId: z.string(),
  tenantId: z.string(),
  currentPhase: z.number().int().min(1).max(5),
  phase1: Phase1AnswersSchema.optional(),
  phase2: Phase2AnswersSchema.optional(),
  phase3: Phase3AnswersSchema.optional(),
  phase4: Phase4AnswersSchema.optional(),
  completed: z.boolean().default(false),
});
export type OnboardingSession = z.infer<typeof OnboardingSessionSchema>;
