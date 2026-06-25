import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { generateArtifacts, generateRootConfigYaml } from './generate-artifacts.js';
import { createEmptyProfile } from '../contracts/onboarding-profile.contracts.js';
import type { OnboardingProfile } from '../contracts/onboarding-profile.contracts.js';
import { parseStructuredDocument } from '../knowledge/authoring/frontmatter-parser.js';
import type { ParsedStructuredClause } from '../knowledge/authoring/structured-clause.types.js';
import { createPolicyLinter } from '../knowledge/linter/policy-linter.service.js';
import { SurfaceContractRegistry } from '../knowledge/surfaces/surface-contract-registry.service.js';
import { PolicyPackSchema as SdkPolicyPackSchema } from '../surfaces/sdk/types.js';

function businessProfile(): OnboardingProfile {
  const p = createEmptyProfile('biz-1');
  p.mode = 'business';
  p.agent.harness = 'openclaw';
  p.agent.detectedTools = ['file_read', 'shell_exec'];
  p.userContext.primaryJobs = ['order processing', 'inventory'];
  p.autonomy.posture = 'guided';
  p.autonomy.defaultAction = 'ask';
  p.autonomy.alwaysRequireApproval = ['deploy'];
  p.provider.mode = 'host';
  p.tools = [
    {
      name: 'deploy_production',
      riskTier: 4,
      canSpendMoney: false,
      canDeleteData: false,
      canContactPeople: false,
      canPublishContent: false,
      canDeployCode: true,
      accessesSensitiveData: false,
      defaultAction: 'block',
    },
    {
      name: 'file_read',
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
  p.data.classes = ['internal', 'pii'];
  p.memory.sources = [
    { kind: 'openclaw-native', detected: true, detectionSignals: ['MEMORY.md'], readConsent: true, writeBackConsent: false, scope: ['onboarding'] },
  ];
  p.evidence = [
    { source: 'interview', confidence: 1.0, sensitive: false, collectedAt: p.createdAt },
  ];
  return p;
}

function result_pack(profile: OnboardingProfile): Record<string, unknown> {
  const art = generateArtifacts(profile).artifacts.find((a) => a.path === 'policy-pack.yaml');
  return parseYaml(art!.content) as Record<string, unknown>;
}

describe('generate-artifacts', () => {
  describe('generateArtifacts', () => {
    it('generates all expected artifact categories for business profile', () => {
      const result = generateArtifacts(businessProfile());
      expect(result.artifacts.length).toBeGreaterThan(0);

      const categories = new Set(result.artifacts.map((a) => a.category));
      expect(categories).toContain('profile');
      expect(categories).toContain('config');
      expect(categories).toContain('policy');
      expect(categories).toContain('surface');
      expect(categories).toContain('test');
      expect(categories).toContain('report');
    });

    it('root runtime config runs in OBSERVE for a non-enterprise profile (non-breaking install), rules still real', () => {
      // generateRootConfigYaml is the runtime decision-core.yaml the CLI setup writes.
      const cfg = parseYaml(generateRootConfigYaml(businessProfile(), '.decision-core/policy-pack.yaml'));
      // Observe = the install does not block existing tools on day one...
      expect(cfg.enforcementMode).toBe('observe');
      // ...but the rules are REAL — deny-unknown stays on; the mode just shadows them.
      expect(cfg.denyUnknownDefault).toBe(true);
    });

    it('root runtime config runs in ENFORCE for an enterprise profile', () => {
      const profile = businessProfile();
      profile.mode = 'enterprise';
      profile.autonomy.enforcementMode = 'enforce';
      expect(parseYaml(generateRootConfigYaml(profile, '.decision-core/policy-pack.yaml')).enforcementMode).toBe('enforce');
    });

    it('observe mode PERSISTS observations (sqlite) when a store path is supplied; otherwise memory', () => {
      const profile = businessProfile(); // observe
      const persisted = generateRootConfigYaml(profile, '.decision-core/policy-pack.yaml', {
        observationStorePath: '.decision-core/decisions.db',
      });
      const cfg = parseYaml(persisted);
      expect(cfg.persistence).toBe('sqlite');
      expect(cfg.sqlitePath).toBe('.decision-core/decisions.db');
      // The header tells the operator how to review + flip.
      expect(persisted).toContain('decision-core observations');
      expect(persisted).toContain('decision-core enforce');

      // No store path (e.g. sqlite unavailable) → memory, no silent sqlite path.
      const memory = parseYaml(generateRootConfigYaml(profile, '.decision-core/policy-pack.yaml'));
      expect(memory.persistence).toBe('memory');
      expect(memory.sqlitePath).toBeUndefined();
      expect(memory.enforcementMode).toBe('observe');
    });

    it('enforce mode never persists via the observe path', () => {
      const profile = businessProfile();
      profile.autonomy.enforcementMode = 'enforce';
      const cfg = parseYaml(generateRootConfigYaml(profile, '.decision-core/policy-pack.yaml', {
        observationStorePath: '.decision-core/decisions.db',
      }));
      expect(cfg.persistence).toBe('memory'); // observe-only persistence
    });

    it('onboarding report ANNOUNCES observe mode + the review/enforce next steps', () => {
      const result = generateArtifacts(businessProfile()); // observe
      const report = result.artifacts.find((a) => a.path === 'reports/onboarding-report.md');
      expect(report).toBeDefined();
      expect(report!.content).toContain('OBSERVE');
      expect(report!.content).toContain('watching, not blocking');
      expect(report!.content).toContain('decision-core observations');
      expect(report!.content).toContain('decision-core enforce');
    });

    it('executive decisions become TOP-priority pack rules (B2): delete_data BLOCK, deploy ASK', () => {
      const profile = businessProfile(); // default executiveDecisions
      const pack = result_pack(profile);
      const execRules = (pack.rules as Array<Record<string, unknown>>).filter((r) => String(r.name).startsWith('exec-'));
      expect(execRules.length).toBeGreaterThan(0);
      const del = execRules.find((r) => r.actionTypePattern === 'delete_*')!;
      expect(del.defaultVerdict).toBe('deny');
      expect(del.priority).toBe(95);
      const deploy = execRules.find((r) => r.actionTypePattern === 'deploy_*')!;
      expect(deploy.requireApproval).toBe(true);
      expect(execRules.some((r) => r.actionTypePattern === 'deploy.*')).toBe(true);
      expect(execRules.some((r) => r.actionTypePattern === 'deploy-*')).toBe(true);
    });

    it('runtime pack preserves dotted and hyphenated tool action names', () => {
      const profile = businessProfile();
      profile.tools = [
        {
          name: 'deploy.production',
          riskTier: 4,
          canSpendMoney: false,
          canDeleteData: false,
          canContactPeople: false,
          canPublishContent: false,
          canDeployCode: true,
          accessesSensitiveData: false,
          defaultAction: 'block',
        },
        {
          name: 'file-read',
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
      const pack = result_pack(profile);
      const patterns = (pack.rules as Array<Record<string, unknown>>).map((r) => r.actionTypePattern);
      expect(patterns).toContain('deploy.production');
      expect(patterns).toContain('file-read');
    });

    it('an explicit ALLOW executive decision emits an allow rule', () => {
      const profile = businessProfile();
      profile.autonomy.executiveDecisions.delete_data = 'allow';
      const pack = result_pack(profile);
      const del = (pack.rules as Array<Record<string, unknown>>).find(
        (r) => String(r.name).startsWith('exec-delete_data') && r.actionTypePattern === 'delete_*',
      );
      expect(del?.defaultVerdict).toBe('allow');
    });

    it('onboarding report surfaces the executive decisions (B3)', () => {
      const report = generateArtifacts(businessProfile()).artifacts.find((a) => a.path === 'reports/onboarding-report.md');
      expect(report!.content).toContain('Executive decisions');
      expect(report!.content).toContain('delete data');
    });

    it('generates baseline policy', () => {
      const result = generateArtifacts(businessProfile());
      const baseline = result.artifacts.find((a) => a.path === 'policies/000-baseline.md');
      expect(baseline).toBeDefined();
      expect(baseline!.content).toContain('decision-core-clause');
      expect(baseline!.content).toContain('baseline-default-action');
      expect(baseline!.content).toContain('business');
    });

    it('generates tool policy with approval gates', () => {
      const result = generateArtifacts(businessProfile());
      const tools = result.artifacts.find((a) => a.path === 'policies/010-tools.md');
      expect(tools).toBeDefined();
      expect(tools!.content).toContain('deploy_production');
      expect(tools!.content).toContain('approval_required: true');
    });

    it('generates data policy', () => {
      const result = generateArtifacts(businessProfile());
      const data = result.artifacts.find((a) => a.path === 'policies/020-data.md');
      expect(data).toBeDefined();
      expect(data!.content).toContain('pii');
      expect(data!.content).toContain('internal');
    });

    it('generates provider routing policy', () => {
      const result = generateArtifacts(businessProfile());
      const provider = result.artifacts.find((a) => a.path === 'policies/030-provider-routing.md');
      expect(provider).toBeDefined();
      expect(provider!.content).toContain('host');
    });

    it('generates memory source policy', () => {
      const result = generateArtifacts(businessProfile());
      const memory = result.artifacts.find((a) => a.path === 'policies/040-memory-sources.md');
      expect(memory).toBeDefined();
      expect(memory!.content).toContain('openclaw-native');
    });

    it('generates test scenarios', () => {
      const result = generateArtifacts(businessProfile());
      const tests = result.artifacts.find((a) => a.path === 'tests/generated-scenarios.json');
      expect(tests).toBeDefined();
      const scenarios = JSON.parse(tests!.content);
      expect(Array.isArray(scenarios)).toBe(true);
      expect(scenarios.length).toBeGreaterThan(0);
      expect(scenarios[0]).toHaveProperty('name');
      expect(scenarios[0]).toHaveProperty('input');
      expect(scenarios[0]).toHaveProperty('expected');
    });

    it('generates onboarding report', () => {
      const result = generateArtifacts(businessProfile());
      const report = result.artifacts.find((a) => a.path === 'reports/onboarding-report.md');
      expect(report).toBeDefined();
      expect(report!.content).toContain('business');
      expect(report!.content).toContain('openclaw');
    });

    it('generates rollback manifest', () => {
      const result = generateArtifacts(businessProfile());
      const manifest = result.artifacts.find((a) => a.path === 'rollback-manifest.json');
      expect(manifest).toBeDefined();
      const parsed = JSON.parse(manifest!.content);
      expect(parsed.files.length).toBeGreaterThan(0);
    });

    it('generates surface contracts', () => {
      const result = generateArtifacts(businessProfile());
      const surfaces = result.artifacts.find((a) => a.path === 'surface-contracts.yaml');
      expect(surfaces).toBeDefined();
      expect(surfaces!.content).toContain('high-risk-operations');
      expect(surfaces!.content).toContain('deploy_production');
    });

    it('produces stable output for same profile', () => {
      const profile = businessProfile();
      const a = generateArtifacts(profile);
      const b = generateArtifacts(profile);
      expect(a.profileHash).toBe(b.profileHash);
      expect(a.artifacts.map((x) => x.path)).toEqual(b.artifacts.map((x) => x.path));
      // Content should be the same for deterministic fields
      for (let i = 0; i < a.artifacts.length; i++) {
        if (a.artifacts[i].category !== 'report') {
          expect(a.artifacts[i].content).toBe(b.artifacts[i].content);
        }
      }
    });

    it('warns when no tools configured', () => {
      const profile = createEmptyProfile('empty-1');
      const result = generateArtifacts(profile);
      expect(result.warnings.some((w) => w.includes('No tools'))).toBe(true);
    });

    it('handles personal profile with minimal config', () => {
      const profile = createEmptyProfile('personal-1');
      const result = generateArtifacts(profile);
      expect(result.artifacts.length).toBeGreaterThan(0);
      const baseline = result.artifacts.find((a) => a.path === 'policies/000-baseline.md');
      expect(baseline!.content).toContain('personal');
    });

    it('rejects invalid profile', () => {
      const result = generateArtifacts({ schemaVersion: 2 } as never);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.artifacts).toEqual([]);
    });

    it('does not include secrets in artifacts', () => {
      const profile = businessProfile();
      profile.provider.envVarName = 'ANTHROPIC_API_KEY';
      const result = generateArtifacts(profile);
      const allContent = result.artifacts.map((a) => a.content).join('\n');
      expect(allContent).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    });

    it('generates policy artifacts that parse and lint with zero errors', () => {
      const result = generateArtifacts(businessProfile());
      const registry = new SurfaceContractRegistry();
      registry.loadFromFile('config/surface-contracts/default.yaml');
      const linter = createPolicyLinter();

      const policies = result.artifacts.filter((a) => a.category === 'policy');
      expect(policies.length).toBeGreaterThan(0);

      for (const policy of policies) {
        const parsed = parseStructuredDocument(policy.content, policy.path);
        const report = linter.lint({
          clauses: parsed.document.clauses,
          frontmatter: parsed.document.frontmatter,
          surfaceRegistry: registry,
          hasStructuredClauses: parsed.parsedClauses.length > 0,
          sourceLineRefs: toSourceLineRefMap(parsed.parsedClauses),
          documentSource: policy.path,
        });

        expect(report.errorCount, `${policy.path}: ${JSON.stringify(report.diagnostics, null, 2)}`).toBe(0);
      }
    });
  });
});

function toSourceLineRefMap(parsedClauses: ParsedStructuredClause[]) {
  return Object.fromEntries(parsedClauses.map(({ clause, sourceLineRef }) => [clause.clause_id, sourceLineRef]));
}

describe('generate-artifacts policy-pack.yaml', () => {
  it('generates a policy-pack.yaml artifact that parses as valid SDK pack', () => {
    const result = generateArtifacts(businessProfile());
    const packArtifact = result.artifacts.find(a => a.path === 'policy-pack.yaml');
    expect(packArtifact).toBeDefined();

    const parsed = parseYaml(packArtifact!.content);
    const validated = SdkPolicyPackSchema.safeParse(parsed);
    expect(validated.success, `SDK schema validation failed: ${validated.error?.message}`).toBe(true);
    if (validated.success) {
      expect(validated.data.denyUnknownDefault).toBe(true);
      expect(validated.data.rules.length).toBeGreaterThan(0);
    }
  });

  it('policy-pack.yaml contains rules for all profile tools', () => {
    const profile = businessProfile();
    const result = generateArtifacts(profile);
    const packArtifact = result.artifacts.find(a => a.path === 'policy-pack.yaml');
    expect(packArtifact).toBeDefined();

    const parsed = parseYaml(packArtifact!.content);
    const validated = SdkPolicyPackSchema.parse(parsed);

    for (const tool of profile.tools) {
      const matching = validated.rules.find(r => r.actionTypePattern === tool.name);
      expect(matching, `No rule found for tool ${tool.name}`).toBeDefined();
    }
  });

  it('high-risk tools get deny verdict in generated pack', () => {
    const profile = businessProfile();
    const result = generateArtifacts(profile);
    const packArtifact = result.artifacts.find(a => a.path === 'policy-pack.yaml');
    const parsed = parseYaml(packArtifact!.content);
    const validated = SdkPolicyPackSchema.parse(parsed);

    const deployRule = validated.rules.find(r => r.actionTypePattern === 'deploy_production');
    expect(deployRule).toBeDefined();
    expect(deployRule!.defaultVerdict).toBe('deny');
  });

  it('scenarios use runtime verdict vocabulary', () => {
    const result = generateArtifacts(businessProfile());
    const scenarios = result.artifacts.find(a => a.path === 'tests/generated-scenarios.json');
    expect(scenarios).toBeDefined();

    const parsed = JSON.parse(scenarios!.content);
    for (const s of parsed) {
      expect(['allow', 'deny', 'approve_required']).toContain(s.expected);
      expect(s.input).toHaveProperty('action');
      expect(s.input).not.toHaveProperty('action_type');
      expect(s.input).not.toHaveProperty('tool_name');
    }
  });

  it('no artifact path escapes the output directory', () => {
    const result = generateArtifacts(businessProfile());
    for (const artifact of result.artifacts) {
      expect(artifact.path).not.toContain('..');
      expect(artifact.path.startsWith('/')).toBe(false);
    }
  });

  it('serializes unusual tool names without breaking runtime YAML', () => {
    const profile = businessProfile();
    profile.tools = [{
      name: 'tool:"quoted"\nnext',
      riskTier: 3,
      canSpendMoney: false,
      canDeleteData: false,
      canContactPeople: false,
      canPublishContent: false,
      canDeployCode: false,
      accessesSensitiveData: false,
      defaultAction: 'ask',
    }];

    const result = generateArtifacts(profile);
    const packArtifact = result.artifacts.find(a => a.path === 'policy-pack.yaml');
    expect(packArtifact).toBeDefined();
    const parsed = parseYaml(packArtifact!.content);
    const validated = SdkPolicyPackSchema.parse(parsed);
    expect(validated.rules[0].actionTypePattern).toBe('tool-quoted-next');
  });
});
