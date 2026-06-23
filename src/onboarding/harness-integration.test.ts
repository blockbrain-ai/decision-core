import { describe, it, expect } from 'vitest';
import { detectAgentEnvironment } from './detect-agent-env.js';
import { generateArtifacts } from './generate-artifacts.js';
import { createEmptyProfile } from '../contracts/onboarding-profile.contracts.js';

let idCounter = 0;
function testProfile() {
  return createEmptyProfile(`test-harness-${++idCounter}`);
}

describe('Harness Integration', () => {
  describe('OpenClaw artifacts', () => {
    it('generates openclaw integration YAML when harness is openclaw', () => {
      const profile = testProfile();
      profile.agent.harness = 'openclaw';
      profile.mode = 'business';
      profile.tools = [
        {
          name: 'file_write',
          riskTier: 2,
          canSpendMoney: false,
          canDeleteData: false,
          canContactPeople: false,
          canPublishContent: false,
          canDeployCode: false,
          accessesSensitiveData: false,
          defaultAction: 'allow',
        },
      ];

      const result = generateArtifacts(profile);
      expect(result.artifacts.length).toBeGreaterThan(0);

      const baseline = result.artifacts.find((a) => a.path === 'policies/000-baseline.md');
      expect(baseline).toBeDefined();
      expect(baseline!.content).toContain('business');
      expect(baseline!.content).toContain('decision-core-clause');
    });

    it('generates tool policy with approval gates for high-risk tools', () => {
      const profile = testProfile();
      profile.agent.harness = 'openclaw';
      profile.mode = 'business';
      profile.tools = [
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
          name: 'read_file',
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

      const result = generateArtifacts(profile);
      const toolPolicy = result.artifacts.find((a) => a.path === 'policies/010-tools.md');
      expect(toolPolicy).toBeDefined();
      expect(toolPolicy!.content).toContain('approval_required: true');
      expect(toolPolicy!.content).toContain('deploy_production');
      expect(toolPolicy!.content).toContain('read_file');
    });

    it('generates openclaw integration artifact', () => {
      const profile = testProfile();
      profile.agent.harness = 'openclaw';

      const result = generateArtifacts(profile);
      const integration = result.artifacts.find((a) => a.path === 'integrations/openclaw.yaml');
      expect(integration).toBeDefined();
      expect(integration!.content).toContain('harness: openclaw');
    });
  });

  describe('Hermes artifacts', () => {
    it('generates artifacts for hermes harness with team mode', () => {
      const profile = testProfile();
      profile.agent.harness = 'hermes';
      profile.mode = 'team';
      profile.provider.mode = 'host';

      const result = generateArtifacts(profile);
      const config = result.artifacts.find((a) => a.path === 'decision-core.config.yaml');
      expect(config).toBeDefined();
      expect(config!.content).toContain('mode: "team"');
      expect(config!.content).toContain('mode: "host"');
    });

    it('generates hermes integration artifact', () => {
      const profile = testProfile();
      profile.agent.harness = 'hermes';

      const result = generateArtifacts(profile);
      const integration = result.artifacts.find((a) => a.path === 'integrations/hermes.yaml');
      expect(integration).toBeDefined();
      expect(integration!.content).toContain('harness: hermes');
    });

    it('generates memory source policy when hermes sources are consented', () => {
      const profile = testProfile();
      profile.agent.harness = 'hermes';
      profile.mode = 'team';
      profile.memory.sources = [
        {
          kind: 'hermes-built-in',
          detected: true,
          detectionSignals: ['~/.hermes/memories/MEMORY.md found'],
          readConsent: true,
          writeBackConsent: false,
          scope: ['memories'],
        },
      ];

      const result = generateArtifacts(profile);
      const memPolicy = result.artifacts.find((a) => a.path === 'policies/040-memory-sources.md');
      expect(memPolicy).toBeDefined();
      expect(memPolicy!.content).toContain('hermes-built-in');
      expect(memPolicy!.content).toContain('read-only');
    });
  });

  describe('Generic artifacts', () => {
    it('generates minimal artifacts for generic harness with personal mode', () => {
      const profile = testProfile();
      profile.agent.harness = 'generic';
      profile.mode = 'personal';

      const result = generateArtifacts(profile);

      expect(result.artifacts.some((a) => a.path === 'policies/000-baseline.md')).toBe(true);
      expect(result.artifacts.some((a) => a.path === 'decision-core.profile.yaml')).toBe(true);
      expect(result.artifacts.some((a) => a.path === 'decision-core.config.yaml')).toBe(true);
      expect(result.artifacts.some((a) => a.path === 'reports/onboarding-report.md')).toBe(true);
      expect(result.artifacts.some((a) => a.path === 'integrations/generic-hook.md')).toBe(true);

      const baseline = result.artifacts.find((a) => a.path === 'policies/000-baseline.md')!;
      expect(baseline.content).toContain('personal');
      expect(baseline.content).toContain('guided');
    });

    it('generates data policy for profiles with data classifications', () => {
      const profile = testProfile();
      profile.agent.harness = 'generic';
      profile.mode = 'business';
      profile.data.classes = ['pii', 'financial', 'internal'];

      const result = generateArtifacts(profile);
      const dataPolicy = result.artifacts.find((a) => a.path === 'policies/020-data.md');
      expect(dataPolicy).toBeDefined();
      expect(dataPolicy!.content).toContain('pii');
      expect(dataPolicy!.content).toContain('financial');
      expect(dataPolicy!.content).toContain('obligation');
    });
  });

  describe('Standalone artifacts', () => {
    it('generates artifacts with no tools warning for standalone', () => {
      const profile = testProfile();
      profile.agent.harness = 'standalone';
      profile.mode = 'personal';

      const result = generateArtifacts(profile);
      expect(result.warnings).toContain('No tools configured — skipping tool policy generation');

      const toolPolicy = result.artifacts.find((a) => a.path === 'policies/010-tools.md');
      expect(toolPolicy).toBeUndefined();
    });
  });

  describe('No secrets in generated artifacts', () => {
    it('no artifacts contain raw secret patterns', () => {
      const profile = testProfile();
      profile.agent.harness = 'openclaw';
      profile.mode = 'enterprise';
      profile.provider.mode = 'direct';
      profile.provider.envVarName = 'ANTHROPIC_API_KEY';
      profile.tools = [
        {
          name: 'payment_process',
          riskTier: 4,
          canSpendMoney: true,
          canDeleteData: false,
          canContactPeople: false,
          canPublishContent: false,
          canDeployCode: false,
          accessesSensitiveData: true,
          defaultAction: 'block',
        },
      ];
      profile.data.classes = ['pii', 'financial', 'credentials'];
      profile.memory.sources = [
        {
          kind: 'gbrain',
          detected: true,
          detectionSignals: ['~/.gbrain/ directory found'],
          readConsent: true,
          writeBackConsent: true,
          scope: ['decisions'],
        },
      ];

      const result = generateArtifacts(profile);

      const secretPatterns = [
        /sk-[A-Za-z0-9]{20,}/,
        /AKIA[0-9A-Z]{16}/,
        /-----BEGIN/,
        /Bearer [A-Za-z0-9._-]{20,}/,
      ];

      for (const artifact of result.artifacts) {
        for (const pattern of secretPatterns) {
          expect(artifact.content).not.toMatch(pattern);
        }
      }
    });
  });

  describe('Surface contracts', () => {
    it('generates surface contracts with risk class grouping', () => {
      const profile = testProfile();
      profile.agent.harness = 'openclaw';
      profile.mode = 'business';
      profile.tools = [
        {
          name: 'delete_database',
          riskTier: 4,
          canSpendMoney: false,
          canDeleteData: true,
          canContactPeople: false,
          canPublishContent: false,
          canDeployCode: false,
          accessesSensitiveData: false,
          defaultAction: 'block',
        },
        {
          name: 'send_email',
          riskTier: 2,
          canSpendMoney: false,
          canDeleteData: false,
          canContactPeople: true,
          canPublishContent: false,
          canDeployCode: false,
          accessesSensitiveData: false,
          defaultAction: 'ask',
        },
        {
          name: 'read_file',
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

      const result = generateArtifacts(profile);
      const surfaces = result.artifacts.find((a) => a.path === 'surface-contracts.yaml');
      expect(surfaces).toBeDefined();
      expect(surfaces!.content).toContain('high-risk-operations');
      expect(surfaces!.content).toContain('riskClass: A');
      expect(surfaces!.content).toContain('delete_database');
      expect(surfaces!.content).toContain('standard-operations');
      expect(surfaces!.content).toContain('riskClass: B');
      expect(surfaces!.content).toContain('send_email');
      expect(surfaces!.content).toContain('low-risk-operations');
      expect(surfaces!.content).toContain('riskClass: C');
      expect(surfaces!.content).toContain('read_file');
    });
  });

  describe('Test scenarios', () => {
    it('generates deterministic test scenarios from profile', () => {
      const profile = testProfile();
      profile.agent.harness = 'generic';
      profile.mode = 'personal';
      profile.tools = [
        {
          name: 'shell_exec',
          riskTier: 3,
          canSpendMoney: false,
          canDeleteData: true,
          canContactPeople: false,
          canPublishContent: false,
          canDeployCode: true,
          accessesSensitiveData: false,
          defaultAction: 'ask',
        },
      ];

      const result = generateArtifacts(profile);
      const scenarios = result.artifacts.find((a) => a.path === 'tests/generated-scenarios.json');
      expect(scenarios).toBeDefined();

      const parsed = JSON.parse(scenarios!.content);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThanOrEqual(2);

      const unknownScenario = parsed.find((s: { name: string }) => s.name === 'unknown action is denied');
      expect(unknownScenario).toBeDefined();
      expect(unknownScenario.expected).toBe('deny');

      const shellScenario = parsed.find((s: { name: string }) => s.name.includes('shell_exec'));
      expect(shellScenario).toBeDefined();
      expect(shellScenario.expected).toBe('approve_required');
    });
  });

  describe('Rollback manifest', () => {
    it('lists all generated artifact paths', () => {
      const profile = testProfile();
      profile.agent.harness = 'generic';
      profile.mode = 'personal';

      const result = generateArtifacts(profile);
      const manifest = result.artifacts.find((a) => a.path === 'rollback-manifest.json');
      expect(manifest).toBeDefined();

      const parsed = JSON.parse(manifest!.content);
      expect(parsed.version).toBe(1);
      expect(Array.isArray(parsed.files)).toBe(true);

      const otherPaths = result.artifacts
        .filter((a) => a.path !== 'rollback-manifest.json')
        .map((a) => a.path);
      for (const path of otherPaths) {
        expect(parsed.files).toContain(path);
      }
    });
  });

  describe('Environment detection integrates with profile creation', () => {
    it('detection returns valid structure for cwd', () => {
      const env = detectAgentEnvironment(process.cwd());
      expect(env.harness).toBeDefined();
      expect(env.harness.harness).toBeTruthy();
      expect(env.harness.confidence).toBeGreaterThanOrEqual(0);
      expect(env.harness.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(env.memorySources)).toBe(true);
      expect(Array.isArray(env.tools)).toBe(true);
      expect(env.scanRoot).toBeTruthy();
    });
  });
});
