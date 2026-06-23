import { describe, it, expect, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getActiveProfile, registerSetupTools, resetActiveProfile } from './setup.tools.js';

async function createTestClient() {
  const server = new McpServer({ name: 'setup-test', version: '0.0.1' });
  registerSetupTools(server);

  const client = new Client({ name: 'setup-test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

function parseResult(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
}

describe('setup.tools', () => {
  beforeEach(() => {
    resetActiveProfile();
  });

  describe('getActiveProfile', () => {
    it('returns null before detection', () => {
      expect(getActiveProfile()).toBeNull();
    });
  });

  describe('resetActiveProfile', () => {
    it('clears the active profile', () => {
      resetActiveProfile();
      expect(getActiveProfile()).toBeNull();
    });
  });

  describe('registered MCP tools', () => {
    it('registers setup tools used by the agent onboarding skill', async () => {
      const { client } = await createTestClient();
      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);

      expect(toolNames).toEqual(expect.arrayContaining([
        'dc_setup_detect',
        'dc_setup_infer',
        'dc_setup_generate',
        'dc_setup_validate',
        'dc_setup_activate',
      ]));
    });

    it('generates artifact contents and validates with parse/lint gates', async () => {
      const { client } = await createTestClient();

      await client.callTool({ name: 'dc_setup_detect', arguments: { scanRoot: process.cwd() } });
      const generateResult = await client.callTool({ name: 'dc_setup_generate', arguments: {} });
      const generated = parseResult(generateResult) as {
        artifacts: Array<{ path: string; content: string; contentLength: number }>;
      };

      const baseline = generated.artifacts.find((artifact) => artifact.path === 'policies/000-baseline.md');
      expect(baseline?.content).toContain('decision-core-clause');
      expect(baseline?.contentLength).toBeGreaterThan(0);

      const validateResult = await client.callTool({ name: 'dc_setup_validate', arguments: {} });
      const validation = parseResult(validateResult) as { valid: boolean; policyCount: number; issues: unknown[] };

      expect(validation.valid).toBe(true);
      expect(validation.policyCount).toBeGreaterThan(0);
      expect(validation.issues).toEqual([]);
    });
  });
});
