/**
 * Onboarding Service
 *
 * Manages the 5-phase interview flow for Decision Core setup.
 * Produces policies.yaml, surfaces.yaml, and provider config.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createLogger } from '../../utils/logger.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import { DecisionCoreConfigSchema } from '../../surfaces/sdk/types.js';
import type {
  OnboardingPhase,
  OnboardingSession,
  AllAnswers,
  GeneratedConfig,
  OnboardingResult,
  ToolDeclaration,
  ToolRiskClass,
} from '../../contracts/onboarding.contracts.js';
import {
  Phase1AnswersSchema,
  Phase2AnswersSchema,
  Phase3AnswersSchema,
  Phase4AnswersSchema,
  AllAnswersSchema,
} from '../../contracts/onboarding.contracts.js';

const logger = createLogger('onboarding-service');

// ===========================================================================
// Phase Definitions
// ===========================================================================

export function getPhase1Questions(): OnboardingPhase {
  return {
    phase: 1,
    title: 'Agent Discovery',
    required: true,
    questions: [
      {
        id: 'agent_description',
        prompt: 'What does your agent do? Describe its purpose in one or two sentences.',
        type: 'text',
      },
      {
        id: 'agent_tools',
        prompt: 'List the tools or capabilities your agent has access to (comma-separated, e.g., file.read, file.write, web.search, deploy.production).',
        type: 'text',
      },
      {
        id: 'data_access',
        prompt: 'What types of data does your agent access?',
        type: 'multi_select',
        options: ['public_data', 'internal_docs', 'user_pii', 'financial_records', 'source_code', 'credentials', 'none'],
        default: 'none',
      },
      {
        id: 'environment',
        prompt: 'Where does this agent run?',
        type: 'select',
        options: ['local_dev', 'staging', 'production', 'ci_cd'],
        default: 'local_dev',
      },
    ],
  };
}

export function getPhase2Questions(tools: string[]): OnboardingPhase {
  return {
    phase: 2,
    title: 'Risk Assessment',
    required: true,
    questions: [
      {
        id: 'high_risk_tools',
        prompt: 'Which of your tools could cause irreversible changes or access sensitive data?',
        type: 'multi_select',
        options: tools,
      },
      {
        id: 'medium_risk_tools',
        prompt: 'Which tools modify state but are generally reversible?',
        type: 'multi_select',
        options: tools,
      },
      {
        id: 'external_services',
        prompt: 'Does your agent call external APIs or third-party services?',
        type: 'confirm',
        default: 'false',
      },
      {
        id: 'can_spend_money',
        prompt: 'Can any tool trigger financial transactions or incur costs?',
        type: 'confirm',
        default: 'false',
      },
      {
        id: 'pii_handling',
        prompt: 'Does your agent process or store personally identifiable information (PII)?',
        type: 'confirm',
        default: 'false',
      },
    ],
  };
}

export function getPhase3Questions(): OnboardingPhase {
  return {
    phase: 3,
    title: 'Governance Posture',
    required: true,
    questions: [
      {
        id: 'risk_profile',
        prompt: 'What governance profile fits your use case?',
        type: 'select',
        options: ['personal', 'team', 'enterprise'],
        default: 'team',
      },
      {
        id: 'team_size',
        prompt: 'How many people use or oversee this agent?',
        type: 'select',
        options: ['solo', 'small', 'large'],
        default: 'solo',
      },
      {
        id: 'compliance_requirements',
        prompt: 'Which compliance standards apply?',
        type: 'multi_select',
        options: ['none', 'sox', 'gdpr', 'hipaa', 'pci_dss', 'iso_27001', 'internal_policy'],
        default: 'none',
      },
      {
        id: 'approval_workflow',
        prompt: 'How should high-risk actions be handled?',
        type: 'select',
        options: ['block', 'approve', 'log_only'],
        default: 'approve',
      },
    ],
  };
}

export function getPhase4Questions(): OnboardingPhase {
  return {
    phase: 4,
    title: 'Provider Selection',
    required: true,
    questions: [
      {
        id: 'provider_mode',
        prompt: 'How should Decision Core connect to AI model providers?',
        type: 'select',
        options: ['host', 'disabled', 'direct', 'local'],
        default: 'disabled',
      },
      {
        id: 'api_key_env_var',
        prompt: 'What environment variable holds your API key? (e.g., ANTHROPIC_API_KEY). Do NOT enter the key itself.',
        type: 'text',
        default: 'ANTHROPIC_API_KEY',
      },
      {
        id: 'local_endpoint',
        prompt: 'What is your local model endpoint? (e.g., http://localhost:11434)',
        type: 'text',
        default: 'http://localhost:11434',
      },
    ],
  };
}

// ===========================================================================
// Session Management
// ===========================================================================

export class OnboardingService {
  private sessions = new Map<string, OnboardingSession>();

  startOnboarding(tenantId: string): { sessionId: string; phase: OnboardingPhase } {
    const sessionId = generateUuidV7();
    const session: OnboardingSession = {
      sessionId,
      tenantId,
      currentPhase: 1,
      completed: false,
    };
    this.sessions.set(sessionId, session);
    logger.info({ sessionId, tenantId }, 'Onboarding session started');
    return { sessionId, phase: getPhase1Questions() };
  }

  processPhaseAnswers(
    sessionId: string,
    phase: number,
    answers: Record<string, unknown>,
  ): { nextPhase?: OnboardingPhase; result?: OnboardingResult } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Onboarding session not found: ${sessionId}`);
    }
    if (session.completed) {
      throw new Error(`Onboarding session already completed: ${sessionId}`);
    }
    if (phase !== session.currentPhase) {
      throw new Error(`Expected phase ${session.currentPhase}, got ${phase}`);
    }

    switch (phase) {
      case 1: {
        const parsed = Phase1AnswersSchema.parse(answers);
        session.phase1 = parsed;
        session.currentPhase = 2;
        logger.info({ sessionId, phase: 1, toolCount: parsed.agentTools.length }, 'Phase 1 completed');
        return { nextPhase: getPhase2Questions(parsed.agentTools) };
      }
      case 2: {
        const parsed = Phase2AnswersSchema.parse(answers);
        session.phase2 = parsed;
        session.currentPhase = 3;
        logger.info({ sessionId, phase: 2 }, 'Phase 2 completed');
        return { nextPhase: getPhase3Questions() };
      }
      case 3: {
        const parsed = Phase3AnswersSchema.parse(answers);
        session.phase3 = parsed;
        session.currentPhase = 4;
        logger.info({ sessionId, phase: 3, riskProfile: parsed.riskProfile }, 'Phase 3 completed');
        return { nextPhase: getPhase4Questions() };
      }
      case 4: {
        const parsed = Phase4AnswersSchema.parse(answers);
        session.phase4 = parsed;
        session.currentPhase = 5;
        logger.info({ sessionId, phase: 4, providerMode: parsed.providerMode }, 'Phase 4 completed');

        const allAnswers: AllAnswers = {
          phase1: session.phase1!,
          phase2: session.phase2!,
          phase3: session.phase3!,
          phase4: parsed,
        };
        const result = this.generateResult(allAnswers);
        session.completed = true;
        logger.info({ sessionId }, 'Onboarding completed — config generated');
        return { result };
      }
      default:
        throw new Error(`Invalid phase: ${phase}`);
    }
  }

  generateConfig(answers: AllAnswers): GeneratedConfig {
    const parsed = AllAnswersSchema.parse(answers);
    return generateAllConfig(parsed);
  }

  validateConfig(config: GeneratedConfig): { valid: boolean; errors: string[] } {
    return validateGeneratedConfig(config);
  }

  getSession(sessionId: string): OnboardingSession | undefined {
    return this.sessions.get(sessionId);
  }

  private generateResult(answers: AllAnswers): OnboardingResult {
    const tools = classifyTools(answers);
    const generatedConfig = generateAllConfig(answers);

    return {
      agentDescription: answers.phase1.agentDescription,
      tools,
      riskProfile: answers.phase3.riskProfile,
      providerMode: answers.phase4.providerMode,
      generatedConfig,
    };
  }
}

// ===========================================================================
// Tool Classification
// ===========================================================================

export function classifyTools(answers: AllAnswers): ToolDeclaration[] {
  const highSet = new Set(answers.phase2.highRiskTools);
  const mediumSet = new Set(answers.phase2.mediumRiskTools);

  return answers.phase1.agentTools.map((name) => {
    let riskClass: ToolRiskClass = 'low';
    if (highSet.has(name)) riskClass = 'high';
    else if (mediumSet.has(name)) riskClass = 'medium';
    return { name, riskClass };
  });
}

// ===========================================================================
// Config Generation
// ===========================================================================

interface PolicyRule {
  name: string;
  actionTypePattern: string;
  riskClass: 'A' | 'B' | 'C';
  enforcementPoint: string;
  policyType: string;
  requireApproval: boolean;
  enabled: boolean;
  maxAmountUsd?: number;
  description?: string;
}

export function generatePoliciesYaml(answers: AllAnswers): string {
  const rules: PolicyRule[] = [];
  const profile = answers.phase3.riskProfile;
  const workflow = answers.phase3.approvalWorkflow;

  // High-risk tools → Risk Class A
  for (const tool of answers.phase2.highRiskTools) {
    rules.push({
      name: `Control ${tool}`,
      actionTypePattern: tool,
      riskClass: 'A',
      enforcementPoint: 'pre_decision',
      policyType: 'safety',
      requireApproval: workflow === 'approve' || workflow === 'block',
      enabled: true,
    });
  }

  // Medium-risk tools → Risk Class B
  for (const tool of answers.phase2.mediumRiskTools) {
    const requireApproval = profile === 'enterprise' && workflow !== 'log_only';
    rules.push({
      name: `Review ${tool}`,
      actionTypePattern: tool,
      riskClass: 'B',
      enforcementPoint: 'action_dispatch',
      policyType: 'business',
      requireApproval,
      enabled: true,
    });
  }

  // Low-risk tools (catch-all for remaining)
  const highSet = new Set(answers.phase2.highRiskTools);
  const mediumSet = new Set(answers.phase2.mediumRiskTools);
  const lowRiskTools = answers.phase1.agentTools.filter(
    (t) => !highSet.has(t) && !mediumSet.has(t),
  );

  if (lowRiskTools.length > 0) {
    const pattern = lowRiskTools.length === 1 ? lowRiskTools[0]! : '*';
    rules.push({
      name: 'Monitor low-risk actions',
      actionTypePattern: pattern,
      riskClass: 'C',
      enforcementPoint: 'post_execution',
      policyType: 'business',
      requireApproval: false,
      enabled: true,
    });
  }

  // Financial constraints
  if (answers.phase2.canSpendMoney) {
    const limit = profile === 'personal' ? 100 : profile === 'team' ? 1000 : 500;
    rules.push({
      name: 'Financial transaction limit',
      actionTypePattern: 'payment.*',
      riskClass: 'A',
      enforcementPoint: 'pre_decision',
      policyType: 'compliance',
      requireApproval: true,
      enabled: true,
      maxAmountUsd: limit,
    });
  }

  // PII compliance rules
  if (answers.phase2.piiHandling) {
    rules.push({
      name: 'PII data access control',
      actionTypePattern: 'data.pii.*',
      riskClass: 'A',
      enforcementPoint: 'pre_decision',
      policyType: 'compliance',
      requireApproval: profile !== 'personal',
      enabled: true,
    });
  }

  // Compliance-specific rules
  const complianceReqs = answers.phase3.complianceRequirements.filter((c) => c !== 'none');
  if (complianceReqs.length > 0) {
    rules.push({
      name: `Compliance audit (${complianceReqs.join(', ')})`,
      actionTypePattern: '*',
      riskClass: 'B',
      enforcementPoint: 'post_execution',
      policyType: 'compliance',
      requireApproval: false,
      enabled: true,
      description: `Audit trail for ${complianceReqs.join(', ')} compliance`,
    });
  }

  const pack = { version: '1.0.0', rules };
  return stringifyYaml(pack);
}

export function generateSurfacesYaml(answers: AllAnswers): string {
  const tools = classifyTools(answers);
  const env = answers.phase1.environment;

  const surfaces: Array<{
    id: string;
    trustTier: string;
    tools: string[];
    environment: string;
  }> = [];

  const highTools = tools.filter((t) => t.riskClass === 'high').map((t) => t.name);
  const mediumTools = tools.filter((t) => t.riskClass === 'medium').map((t) => t.name);
  const lowTools = tools.filter((t) => t.riskClass === 'low').map((t) => t.name);

  if (highTools.length > 0) {
    surfaces.push({
      id: 'restricted',
      trustTier: 'high',
      tools: highTools,
      environment: env,
    });
  }

  if (mediumTools.length > 0) {
    surfaces.push({
      id: 'standard',
      trustTier: 'medium',
      tools: mediumTools,
      environment: env,
    });
  }

  if (lowTools.length > 0) {
    surfaces.push({
      id: 'open',
      trustTier: 'low',
      tools: lowTools,
      environment: env,
    });
  }

  const config = { version: '1.0.0', surfaces };
  return stringifyYaml(config);
}

export function generateProviderYaml(answers: AllAnswers): string {
  const mode = answers.phase4.providerMode;

  const providerBlock: Record<string, unknown> = { mode };

  if (mode === 'direct' && answers.phase4.apiKeyEnvVar) {
    providerBlock['apiKeyEnvVar'] = answers.phase4.apiKeyEnvVar;
  }

  if (mode === 'local' && answers.phase4.localEndpoint) {
    providerBlock['endpoint'] = answers.phase4.localEndpoint;
  }

  const config = {
    tenantId: 'default',
    persistence: 'memory',
    provider: providerBlock,
  };
  return stringifyYaml(config);
}

export function generateAllConfig(answers: AllAnswers): GeneratedConfig {
  return {
    policies: generatePoliciesYaml(answers),
    surfaces: generateSurfacesYaml(answers),
    provider: generateProviderYaml(answers),
  };
}

// ===========================================================================
// Config Validation
// ===========================================================================

export function validateGeneratedConfig(config: GeneratedConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check policies.yaml contains no plaintext secrets
  const secretPatterns = [/api[_-]?key\s*[:=]\s*[a-zA-Z0-9]{20,}/i, /sk-[a-zA-Z0-9]{20,}/i, /password\s*[:=]\s*\S+/i];
  for (const pattern of secretPatterns) {
    if (pattern.test(config.policies)) errors.push('policies.yaml may contain plaintext secrets');
    if (pattern.test(config.surfaces)) errors.push('surfaces.yaml may contain plaintext secrets');
    if (pattern.test(config.provider)) errors.push('provider config may contain plaintext secrets');
  }

  // Validate policies YAML parses
  try {
    const policiesParsed = parseYaml(config.policies) as { version?: string; rules?: unknown[] } | null;
    if (!policiesParsed || !Array.isArray(policiesParsed.rules)) {
      errors.push('policies.yaml must contain a rules array');
    }
  } catch {
    errors.push('policies.yaml is not valid YAML');
  }

  // Validate surfaces YAML parses
  try {
    const surfacesParsed = parseYaml(config.surfaces) as { surfaces?: unknown[] } | null;
    if (!surfacesParsed || !Array.isArray(surfacesParsed.surfaces)) {
      errors.push('surfaces.yaml must contain a surfaces array');
    }
  } catch {
    errors.push('surfaces.yaml is not valid YAML');
  }

  // Validate provider config parses and matches DecisionCoreConfig shape
  try {
    const providerParsed = parseYaml(config.provider);
    const result = DecisionCoreConfigSchema.safeParse(providerParsed);
    if (!result.success) {
      errors.push(`Provider config invalid: ${result.error.issues.map((i) => i.message).join(', ')}`);
    }
  } catch {
    errors.push('Provider config is not valid YAML');
  }

  return { valid: errors.length === 0, errors };
}
