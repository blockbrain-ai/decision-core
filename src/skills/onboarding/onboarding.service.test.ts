/**
 * Onboarding Service Tests
 *
 * Tests for all 5 interview phases, config generation, and validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  OnboardingService,
  getPhase1Questions,
  getPhase2Questions,
  getPhase3Questions,
  getPhase4Questions,
  classifyTools,
  generatePoliciesYaml,
  generateSurfacesYaml,
  generateProviderYaml,
  generateAllConfig,
  validateGeneratedConfig,
} from './onboarding.service.js';
import type { AllAnswers, GeneratedConfig } from '../../contracts/onboarding.contracts.js';

// ===========================================================================
// Fixtures
// ===========================================================================

function makePersonalAnswers(): AllAnswers {
  return {
    phase1: {
      agentDescription: 'A coding assistant that helps with file editing',
      agentTools: ['file.read', 'file.write', 'web.search'],
      dataAccess: ['source_code'],
      environment: 'local_dev',
    },
    phase2: {
      highRiskTools: [],
      mediumRiskTools: ['file.write'],
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
      providerMode: 'disabled',
    },
  };
}

function makeTeamAnswers(): AllAnswers {
  return {
    phase1: {
      agentDescription: 'Deployment automation agent for team projects',
      agentTools: ['file.read', 'file.write', 'deploy.staging', 'deploy.production', 'db.query', 'db.write'],
      dataAccess: ['internal_docs', 'source_code'],
      environment: 'staging',
    },
    phase2: {
      highRiskTools: ['deploy.production', 'db.write'],
      mediumRiskTools: ['deploy.staging', 'file.write'],
      externalServices: true,
      canSpendMoney: false,
      piiHandling: false,
    },
    phase3: {
      riskProfile: 'team',
      teamSize: 'small',
      complianceRequirements: ['none'],
      approvalWorkflow: 'approve',
    },
    phase4: {
      providerMode: 'host',
    },
  };
}

function makeEnterpriseAnswers(): AllAnswers {
  return {
    phase1: {
      agentDescription: 'Financial processing agent for payment workflows',
      agentTools: ['payment.process', 'payment.refund', 'data.pii.read', 'report.generate', 'email.send'],
      dataAccess: ['user_pii', 'financial_records'],
      environment: 'production',
    },
    phase2: {
      highRiskTools: ['payment.process', 'payment.refund', 'data.pii.read'],
      mediumRiskTools: ['email.send'],
      externalServices: true,
      canSpendMoney: true,
      piiHandling: true,
    },
    phase3: {
      riskProfile: 'enterprise',
      teamSize: 'large',
      complianceRequirements: ['gdpr', 'pci_dss'],
      approvalWorkflow: 'approve',
    },
    phase4: {
      providerMode: 'direct',
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    },
  };
}

// ===========================================================================
// Phase Question Tests
// ===========================================================================

describe('onboard phase questions', () => {
  it('returns phase 1 questions with correct structure', () => {
    const phase = getPhase1Questions();
    expect(phase.phase).toBe(1);
    expect(phase.title).toBe('Agent Discovery');
    expect(phase.required).toBe(true);
    expect(phase.questions).toHaveLength(4);
    expect(phase.questions.map((q) => q.id)).toEqual([
      'agent_description', 'agent_tools', 'data_access', 'environment',
    ]);
  });

  it('returns phase 2 questions populated with tool list', () => {
    const tools = ['file.read', 'file.write', 'deploy.prod'];
    const phase = getPhase2Questions(tools);
    expect(phase.phase).toBe(2);
    expect(phase.title).toBe('Risk Assessment');
    expect(phase.questions[0]!.options).toEqual(tools);
    expect(phase.questions[1]!.options).toEqual(tools);
  });

  it('returns phase 3 governance posture questions', () => {
    const phase = getPhase3Questions();
    expect(phase.phase).toBe(3);
    expect(phase.title).toBe('Governance Posture');
    expect(phase.questions.map((q) => q.id)).toEqual([
      'risk_profile', 'team_size', 'compliance_requirements', 'approval_workflow',
    ]);
  });

  it('returns phase 4 provider selection questions', () => {
    const phase = getPhase4Questions();
    expect(phase.phase).toBe(4);
    expect(phase.title).toBe('Provider Selection');
    expect(phase.questions[0]!.options).toEqual(['host', 'disabled', 'direct', 'local']);
  });
});

// ===========================================================================
// Session Flow Tests
// ===========================================================================

describe('onboard session flow', () => {
  let service: OnboardingService;

  beforeEach(() => {
    service = new OnboardingService();
  });

  it('starts onboarding and returns session + phase 1', () => {
    const { sessionId, phase } = service.startOnboarding('tenant-1');
    expect(sessionId).toBeTruthy();
    expect(phase.phase).toBe(1);
    expect(phase.questions.length).toBeGreaterThan(0);
  });

  it('processes all 4 phases and produces a result', () => {
    const answers = makeTeamAnswers();
    const { sessionId } = service.startOnboarding('tenant-1');

    const r1 = service.processPhaseAnswers(sessionId, 1, answers.phase1);
    expect(r1.nextPhase).toBeDefined();
    expect(r1.nextPhase!.phase).toBe(2);

    const r2 = service.processPhaseAnswers(sessionId, 2, answers.phase2);
    expect(r2.nextPhase).toBeDefined();
    expect(r2.nextPhase!.phase).toBe(3);

    const r3 = service.processPhaseAnswers(sessionId, 3, answers.phase3);
    expect(r3.nextPhase).toBeDefined();
    expect(r3.nextPhase!.phase).toBe(4);

    const r4 = service.processPhaseAnswers(sessionId, 4, answers.phase4);
    expect(r4.result).toBeDefined();
    expect(r4.result!.riskProfile).toBe('team');
    expect(r4.result!.providerMode).toBe('host');
    expect(r4.result!.generatedConfig.policies).toBeTruthy();
    expect(r4.result!.generatedConfig.surfaces).toBeTruthy();
    expect(r4.result!.generatedConfig.provider).toBeTruthy();
  });

  it('throws on invalid session ID', () => {
    expect(() => service.processPhaseAnswers('nonexistent', 1, {})).toThrow('not found');
  });

  it('throws on out-of-order phase', () => {
    const { sessionId } = service.startOnboarding('tenant-1');
    expect(() => service.processPhaseAnswers(sessionId, 2, {})).toThrow('Expected phase 1');
  });

  it('throws on completed session', () => {
    const answers = makePersonalAnswers();
    const { sessionId } = service.startOnboarding('tenant-1');
    service.processPhaseAnswers(sessionId, 1, answers.phase1);
    service.processPhaseAnswers(sessionId, 2, answers.phase2);
    service.processPhaseAnswers(sessionId, 3, answers.phase3);
    service.processPhaseAnswers(sessionId, 4, answers.phase4);

    expect(() => service.processPhaseAnswers(sessionId, 4, answers.phase4)).toThrow('already completed');
  });

  it('validates Zod schemas on phase answers', () => {
    const { sessionId } = service.startOnboarding('tenant-1');
    expect(() => service.processPhaseAnswers(sessionId, 1, {
      agentDescription: '', // too short
      agentTools: [],       // empty
      dataAccess: ['none'],
      environment: 'local_dev',
    })).toThrow();
  });
});

// ===========================================================================
// Tool Classification Tests
// ===========================================================================

describe('onboard classifyTools', () => {
  it('classifies tools by risk level', () => {
    const answers = makeTeamAnswers();
    const tools = classifyTools(answers);

    const highTools = tools.filter((t) => t.riskClass === 'high');
    const mediumTools = tools.filter((t) => t.riskClass === 'medium');
    const lowTools = tools.filter((t) => t.riskClass === 'low');

    expect(highTools.map((t) => t.name)).toContain('deploy.production');
    expect(highTools.map((t) => t.name)).toContain('db.write');
    expect(mediumTools.map((t) => t.name)).toContain('deploy.staging');
    expect(mediumTools.map((t) => t.name)).toContain('file.write');
    expect(lowTools.map((t) => t.name)).toContain('file.read');
    expect(lowTools.map((t) => t.name)).toContain('db.query');
  });
});

// ===========================================================================
// Config Generation Tests
// ===========================================================================

describe('onboard generatePoliciesYaml', () => {
  it('generates valid YAML for personal profile', () => {
    const yaml = generatePoliciesYaml(makePersonalAnswers());
    const parsed = parseYaml(yaml) as { version: string; rules: unknown[] };
    expect(parsed.version).toBe('1.0.0');
    expect(Array.isArray(parsed.rules)).toBe(true);
    expect(parsed.rules.length).toBeGreaterThan(0);
  });

  it('generates high-risk rules with approval for team profile', () => {
    const yaml = generatePoliciesYaml(makeTeamAnswers());
    const parsed = parseYaml(yaml) as { rules: Array<{ actionTypePattern: string; riskClass: string; requireApproval: boolean }> };
    const prodDeploy = parsed.rules.find((r) => r.actionTypePattern === 'deploy.production');
    expect(prodDeploy).toBeDefined();
    expect(prodDeploy!.riskClass).toBe('A');
    expect(prodDeploy!.requireApproval).toBe(true);
  });

  it('generates financial constraints for enterprise profile', () => {
    const yaml = generatePoliciesYaml(makeEnterpriseAnswers());
    const parsed = parseYaml(yaml) as { rules: Array<{ actionTypePattern: string; maxAmountUsd?: number }> };
    const financial = parsed.rules.find((r) => r.actionTypePattern === 'payment.*');
    expect(financial).toBeDefined();
    expect(financial!.maxAmountUsd).toBeDefined();
  });

  it('generates PII compliance rules when piiHandling is true', () => {
    const yaml = generatePoliciesYaml(makeEnterpriseAnswers());
    const parsed = parseYaml(yaml) as { rules: Array<{ actionTypePattern: string; policyType: string }> };
    const piiRule = parsed.rules.find((r) => r.actionTypePattern === 'data.pii.*');
    expect(piiRule).toBeDefined();
    expect(piiRule!.policyType).toBe('compliance');
  });

  it('generates compliance audit rule when compliance standards are set', () => {
    const yaml = generatePoliciesYaml(makeEnterpriseAnswers());
    const parsed = parseYaml(yaml) as { rules: Array<{ name: string }> };
    const complianceRule = parsed.rules.find((r) => r.name.includes('Compliance audit'));
    expect(complianceRule).toBeDefined();
  });

  it('personal profile with log_only does not require approval', () => {
    const yaml = generatePoliciesYaml(makePersonalAnswers());
    const parsed = parseYaml(yaml) as { rules: Array<{ requireApproval: boolean }> };
    const allNoApproval = parsed.rules.every((r) => !r.requireApproval);
    expect(allNoApproval).toBe(true);
  });
});

describe('onboard generateSurfacesYaml', () => {
  it('generates valid YAML with surface bindings', () => {
    const yaml = generateSurfacesYaml(makeTeamAnswers());
    const parsed = parseYaml(yaml) as { version: string; surfaces: Array<{ id: string; trustTier: string; tools: string[] }> };
    expect(parsed.version).toBe('1.0.0');
    expect(Array.isArray(parsed.surfaces)).toBe(true);
  });

  it('separates tools into trust tiers', () => {
    const yaml = generateSurfacesYaml(makeTeamAnswers());
    const parsed = parseYaml(yaml) as { surfaces: Array<{ id: string; trustTier: string; tools: string[] }> };
    const restricted = parsed.surfaces.find((s) => s.id === 'restricted');
    const standard = parsed.surfaces.find((s) => s.id === 'standard');
    const open = parsed.surfaces.find((s) => s.id === 'open');

    expect(restricted).toBeDefined();
    expect(restricted!.tools).toContain('deploy.production');
    expect(standard).toBeDefined();
    expect(standard!.tools).toContain('file.write');
    expect(open).toBeDefined();
    expect(open!.tools).toContain('file.read');
  });
});

describe('onboard generateProviderYaml', () => {
  it('generates disabled provider config', () => {
    const yaml = generateProviderYaml(makePersonalAnswers());
    const parsed = parseYaml(yaml) as { provider: { mode: string } };
    expect(parsed.provider.mode).toBe('disabled');
  });

  it('generates direct provider with env var reference (not plaintext)', () => {
    const yaml = generateProviderYaml(makeEnterpriseAnswers());
    const parsed = parseYaml(yaml) as { provider: { mode: string; apiKeyEnvVar: string } };
    expect(parsed.provider.mode).toBe('direct');
    expect(parsed.provider.apiKeyEnvVar).toBe('ANTHROPIC_API_KEY');
    expect(yaml).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
  });

  it('generates local provider with endpoint', () => {
    const answers = makePersonalAnswers();
    answers.phase4.providerMode = 'local';
    answers.phase4.localEndpoint = 'http://localhost:11434';
    const yaml = generateProviderYaml(answers);
    const parsed = parseYaml(yaml) as { provider: { mode: string; endpoint: string } };
    expect(parsed.provider.mode).toBe('local');
    expect(parsed.provider.endpoint).toBe('http://localhost:11434');
  });
});

// ===========================================================================
// Validation Tests
// ===========================================================================

describe('onboard validateGeneratedConfig', () => {
  it('validates correct config as valid', () => {
    const config = generateAllConfig(makeTeamAnswers());
    const result = validateGeneratedConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates personal profile config as valid', () => {
    const config = generateAllConfig(makePersonalAnswers());
    const result = validateGeneratedConfig(config);
    expect(result.valid).toBe(true);
  });

  it('validates enterprise profile config as valid', () => {
    const config = generateAllConfig(makeEnterpriseAnswers());
    const result = validateGeneratedConfig(config);
    expect(result.valid).toBe(true);
  });

  it('detects invalid YAML in policies', () => {
    const config: GeneratedConfig = {
      policies: '{ invalid: yaml: [',
      surfaces: generateSurfacesYaml(makePersonalAnswers()),
      provider: generateProviderYaml(makePersonalAnswers()),
    };
    const result = validateGeneratedConfig(config);
    expect(result.valid).toBe(false);
  });

  it('detects missing rules array in policies', () => {
    const config: GeneratedConfig = {
      policies: 'version: "1.0.0"\nnoRules: true\n',
      surfaces: generateSurfacesYaml(makePersonalAnswers()),
      provider: generateProviderYaml(makePersonalAnswers()),
    };
    const result = validateGeneratedConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('rules array'))).toBe(true);
  });

  it('generated config never contains plaintext secrets', () => {
    const config = generateAllConfig(makeEnterpriseAnswers());
    expect(config.policies).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    expect(config.surfaces).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    expect(config.provider).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
  });
});

// ===========================================================================
// Integration: Full Flow → Valid Config
// ===========================================================================

describe('onboard integration: full flow produces valid config', () => {
  it('personal profile end-to-end', () => {
    const service = new OnboardingService();
    const answers = makePersonalAnswers();
    const config = service.generateConfig(answers);
    const validation = service.validateConfig(config);
    expect(validation.valid).toBe(true);
  });

  it('team profile end-to-end', () => {
    const service = new OnboardingService();
    const answers = makeTeamAnswers();
    const config = service.generateConfig(answers);
    const validation = service.validateConfig(config);
    expect(validation.valid).toBe(true);
  });

  it('enterprise profile end-to-end', () => {
    const service = new OnboardingService();
    const answers = makeEnterpriseAnswers();
    const config = service.generateConfig(answers);
    const validation = service.validateConfig(config);
    expect(validation.valid).toBe(true);
  });

  it('session-based flow produces valid config', () => {
    const service = new OnboardingService();
    const answers = makeTeamAnswers();
    const { sessionId } = service.startOnboarding('test-tenant');

    service.processPhaseAnswers(sessionId, 1, answers.phase1);
    service.processPhaseAnswers(sessionId, 2, answers.phase2);
    service.processPhaseAnswers(sessionId, 3, answers.phase3);
    const r4 = service.processPhaseAnswers(sessionId, 4, answers.phase4);

    expect(r4.result).toBeDefined();
    const validation = service.validateConfig(r4.result!.generatedConfig);
    expect(validation.valid).toBe(true);

    const session = service.getSession(sessionId);
    expect(session!.completed).toBe(true);
  });

  it('default risk profile produces restrictive-but-usable policy', () => {
    const answers = makeTeamAnswers();
    answers.phase3.riskProfile = 'team';
    answers.phase3.approvalWorkflow = 'approve';

    const config = generateAllConfig(answers);
    const policies = parseYaml(config.policies) as { rules: Array<{ riskClass: string; requireApproval: boolean }> };

    // High-risk tools should require approval
    const classARules = policies.rules.filter((r) => r.riskClass === 'A');
    expect(classARules.length).toBeGreaterThan(0);
    expect(classARules.every((r) => r.requireApproval)).toBe(true);

    // Low-risk tools should not require approval
    const classCRules = policies.rules.filter((r) => r.riskClass === 'C');
    expect(classCRules.length).toBeGreaterThan(0);
    expect(classCRules.every((r) => !r.requireApproval)).toBe(true);
  });
});
