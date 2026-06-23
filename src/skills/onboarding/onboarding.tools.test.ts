/**
 * Onboarding MCP Tools Tests
 *
 * Tests the MCP tool registration and end-to-end tool flow with mock answers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { OnboardingService } from './onboarding.service.js';
import { registerOnboardingTools } from './onboarding.tools.js';

async function createTestClient(service: OnboardingService) {
  const server = new McpServer({ name: 'test', version: '0.0.1' });
  registerOnboardingTools(server, 'test-tenant', service);

  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

function parseResult(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
}

describe('onboard MCP tools', () => {
  let service: OnboardingService;

  beforeEach(() => {
    service = new OnboardingService();
  });

  it('registers 4 onboarding tools', async () => {
    const { client } = await createTestClient(service);
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    expect(toolNames).toContain('dc_onboard_start');
    expect(toolNames).toContain('dc_onboard_answer');
    expect(toolNames).toContain('dc_onboard_generate');
    expect(toolNames).toContain('dc_onboard_validate');
  });

  it('dc_onboard_start returns session and phase 1', async () => {
    const { client } = await createTestClient(service);
    const result = await client.callTool({ name: 'dc_onboard_start', arguments: {} });
    const data = parseResult(result) as { sessionId: string; phase: { phase: number; title: string } };

    expect(data.sessionId).toBeTruthy();
    expect(data.phase.phase).toBe(1);
    expect(data.phase.title).toBe('Agent Discovery');
  });

  it('dc_onboard_answer processes phase 1 and returns phase 2', async () => {
    const { client } = await createTestClient(service);

    const startResult = await client.callTool({ name: 'dc_onboard_start', arguments: {} });
    const { sessionId } = parseResult(startResult) as { sessionId: string };

    const result = await client.callTool({
      name: 'dc_onboard_answer',
      arguments: {
        sessionId,
        phase: 1,
        answers: {
          agentDescription: 'Test agent',
          agentTools: ['file.read', 'file.write'],
          dataAccess: ['source_code'],
          environment: 'local_dev',
        },
      },
    });

    const data = parseResult(result) as { nextPhase: { phase: number } };
    expect(data.nextPhase).toBeDefined();
    expect(data.nextPhase.phase).toBe(2);
  });

  it('dc_onboard_answer returns error for invalid session', async () => {
    const { client } = await createTestClient(service);

    const result = await client.callTool({
      name: 'dc_onboard_answer',
      arguments: {
        sessionId: 'nonexistent',
        phase: 1,
        answers: {},
      },
    });

    const data = parseResult(result) as { error: string };
    expect(data.error).toBeTruthy();
  });

  it('dc_onboard_generate produces config from all answers', async () => {
    const { client } = await createTestClient(service);

    const result = await client.callTool({
      name: 'dc_onboard_generate',
      arguments: {
        phase1: {
          agentDescription: 'Test agent',
          agentTools: ['file.read', 'deploy.prod'],
          dataAccess: ['source_code'],
          environment: 'local_dev',
        },
        phase2: {
          highRiskTools: ['deploy.prod'],
          mediumRiskTools: [],
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
      },
    });

    const data = parseResult(result) as { policies: string; surfaces: string; provider: string };
    expect(data.policies).toBeTruthy();
    expect(data.surfaces).toBeTruthy();
    expect(data.provider).toBeTruthy();
  });

  it('dc_onboard_validate validates correct config', async () => {
    const { client } = await createTestClient(service);

    // First generate config
    const genResult = await client.callTool({
      name: 'dc_onboard_generate',
      arguments: {
        phase1: {
          agentDescription: 'Test agent',
          agentTools: ['file.read'],
          dataAccess: ['none'],
          environment: 'local_dev',
        },
        phase2: {
          highRiskTools: [],
          mediumRiskTools: [],
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
      },
    });

    const config = parseResult(genResult) as { policies: string; surfaces: string; provider: string };

    const result = await client.callTool({
      name: 'dc_onboard_validate',
      arguments: {
        policies: config.policies,
        surfaces: config.surfaces,
        provider: config.provider,
      },
    });

    const data = parseResult(result) as { valid: boolean; errors: string[] };
    expect(data.valid).toBe(true);
    expect(data.errors).toHaveLength(0);
  });

  it('end-to-end: start → answer all phases → validate', async () => {
    const { client } = await createTestClient(service);

    // Start
    const startResult = await client.callTool({ name: 'dc_onboard_start', arguments: {} });
    const { sessionId } = parseResult(startResult) as { sessionId: string };

    // Phase 1
    await client.callTool({
      name: 'dc_onboard_answer',
      arguments: {
        sessionId,
        phase: 1,
        answers: {
          agentDescription: 'CI/CD agent',
          agentTools: ['build.run', 'deploy.prod', 'test.run'],
          dataAccess: ['source_code'],
          environment: 'ci_cd',
        },
      },
    });

    // Phase 2
    await client.callTool({
      name: 'dc_onboard_answer',
      arguments: {
        sessionId,
        phase: 2,
        answers: {
          highRiskTools: ['deploy.prod'],
          mediumRiskTools: ['build.run'],
          externalServices: true,
          canSpendMoney: false,
          piiHandling: false,
        },
      },
    });

    // Phase 3
    await client.callTool({
      name: 'dc_onboard_answer',
      arguments: {
        sessionId,
        phase: 3,
        answers: {
          riskProfile: 'team',
          teamSize: 'small',
          complianceRequirements: ['none'],
          approvalWorkflow: 'approve',
        },
      },
    });

    // Phase 4 — returns result
    const r4 = await client.callTool({
      name: 'dc_onboard_answer',
      arguments: {
        sessionId,
        phase: 4,
        answers: {
          providerMode: 'disabled',
        },
      },
    });

    const data = parseResult(r4) as { result: { riskProfile: string; generatedConfig: { policies: string; surfaces: string; provider: string } } };
    expect(data.result).toBeDefined();
    expect(data.result.riskProfile).toBe('team');
    expect(data.result.generatedConfig).toBeDefined();

    // Validate
    const valResult = await client.callTool({
      name: 'dc_onboard_validate',
      arguments: {
        policies: data.result.generatedConfig.policies,
        surfaces: data.result.generatedConfig.surfaces,
        provider: data.result.generatedConfig.provider,
      },
    });

    const valData = parseResult(valResult) as { valid: boolean };
    expect(valData.valid).toBe(true);
  });
});
