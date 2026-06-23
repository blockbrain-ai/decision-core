import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { provisionAgents, resolveProvisionAuthStorePath, verifyProvision } from './provision-agent.js';

describe('provision-agent', () => {
  it('writes salted auth bindings to the default server lookup path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dc-provision-'));

    try {
      const outputDir = join(root, '.decision-core', 'agents');
      const agentsPath = resolve('config/agents/small-business-agents.yaml');
      const accessPolicyPath = resolve('config/access-policy/small-business-access-policy.yaml');

      const result = await provisionAgents(agentsPath, accessPolicyPath, outputDir);
      const authStorePath = resolveProvisionAuthStorePath(outputDir);

      expect(result.authBindingsWritten).toBe(authStorePath);
      expect(existsSync(authStorePath)).toBe(true);
      expect(existsSync(join(outputDir, 'ceo-agent', 'agent.env'))).toBe(true);

      const parsed = parseYaml(readFileSync(authStorePath, 'utf-8')) as {
        bindings: Array<{ subject: string; salt?: string; agentId: string }>;
      };
      expect(parsed.bindings.length).toBeGreaterThan(0);
      expect(parsed.bindings.every((binding) => /^[0-9a-f]{64}$/.test(binding.subject))).toBe(true);
      expect(parsed.bindings.every((binding) => /^[0-9a-f]{32}$/.test(binding.salt ?? ''))).toBe(true);

      const verify = await verifyProvision(agentsPath, accessPolicyPath, outputDir);
      expect(verify.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
