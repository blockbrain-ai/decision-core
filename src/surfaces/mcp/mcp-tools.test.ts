/**
 * MCP Tools Tests
 *
 * Tests tool registration, invocation, and error handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './mcp-tools.js';
import type { McpServerDeps } from './types.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyRule, PolicyRuleCreateInput } from '../../contracts/policy.contracts.js';
import type { DecisionRecord } from '../../contracts/decision.contracts.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

function createMockDeps(): McpServerDeps {
  const rules: PolicyRule[] = [
    {
      id: 'rule-1',
      name: 'block-deploy',
      description: 'Block production deploys',
      actionTypePattern: 'deploy.production',
      riskClass: 'A',
      enforcementPoint: 'pre_decision',
      policyType: 'safety',
      priority: 100,
      requiredConstraints: [],
      requireApproval: true,
      enabled: true,
      tenantId: 'test-tenant',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const decisionRecords: DecisionRecord[] = [
    {
      id: 'dec-1',
      surface: 'mcp',
      toolName: 'evaluate',
      status: 'generated',
      confidence: 0.95,
      latency: 12,
      input: { action: 'file.write' },
      output: { verdict: 'allow' },
      correlationId: 'corr-123',
      tenantId: 'test-tenant',
      auditHash: 'hash-abc',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  return {
    tenantId: 'test-tenant',
    policyEvaluator: {
      async evaluate(_tenantId, _surfaceId, action, _context) {
        if (action === 'deploy.production') {
          return {
            verdict: 'deny' as const,
            matchedPolicies: [{
              ruleId: 'rule-1',
              ruleName: 'block-deploy',
              verdict: 'deny' as const,
              reason: 'Production deploys require approval',
            }],
          };
        }
        return { verdict: 'allow' as const, matchedPolicies: [] };
      },
    },
    policyRuleRepo: {
      async findAll(_tenantId: TenantId) {
        return rules;
      },
      async create(_tenantId: TenantId, input: PolicyRuleCreateInput) {
        const rule: PolicyRule = {
          ...input,
          id: 'rule-new',
          requiredConstraints: input.requiredConstraints ?? [],
          tenantId: 'test-tenant',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        };
        return rule;
      },
    },
    decisionLogRepo: {
      async findAll(_tenantId: TenantId) {
        return decisionRecords;
      },
      async findByCorrelationId(_tenantId: TenantId, correlationId: string) {
        return decisionRecords.filter((r) => r.correlationId === correlationId);
      },
    },
    ruleCompiler: {
      async compile(_tenantId: TenantId, clauseIds: string[]) {
        return { compiled: clauseIds.length, rules: [] };
      },
    },
  };
}

async function createTestClient(deps: McpServerDeps, opts?: { allowPolicyMutations?: boolean }) {
  const server = new McpServer({ name: 'test', version: '0.1.0' });
  // Default to mutations-enabled so the mutating-tool tests below exercise them.
  registerTools(server, deps, { allowPolicyMutations: opts?.allowPolicyMutations ?? true });

  const client = new Client({ name: 'test-client', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

describe('MCP Tools', () => {
  let deps: McpServerDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  describe('tool registration', () => {
    it('registers all 7 tools', async () => {
      const { client } = await createTestClient(deps);
      const tools = await client.listTools();
      const toolNames = tools.tools.map((t) => t.name);

      expect(toolNames).toContain('evaluate');
      expect(toolNames).toContain('query_policy');
      expect(toolNames).toContain('list_policy_rules');
      expect(toolNames).toContain('explain_decision');
      expect(toolNames).toContain('audit_trail');
      expect(toolNames).toContain('dc_observations');
      expect(toolNames).toContain('ingest_policy');
      expect(toolNames).toContain('compile_rules');
      expect(tools.tools).toHaveLength(8);
    });

    it('does NOT expose the policy-MUTATING tools by default (allowPolicyMutations off)', async () => {
      const { client } = await createTestClient(deps, { allowPolicyMutations: false });
      const names = (await client.listTools()).tools.map((t) => t.name);
      // Mutating tools are gated off...
      expect(names).not.toContain('ingest_policy');
      expect(names).not.toContain('compile_rules');
      // ...read-only tools remain available (incl. the new observations review tool).
      expect(names).toContain('evaluate');
      expect(names).toContain('audit_trail');
      expect(names).toContain('dc_observations');
      expect(names).toHaveLength(6);
    });
  });

  describe('evaluate tool', () => {
    it('returns allow verdict for safe action', async () => {
      const { client } = await createTestClient(deps);
      const result = await client.callTool({ name: 'evaluate', arguments: { surfaceId: 'mcp', action: 'file.read' } });
      const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(parsed.verdict).toBe('allow');
    });

    it('returns deny verdict for blocked action', async () => {
      const { client } = await createTestClient(deps);
      const result = await client.callTool({ name: 'evaluate', arguments: { surfaceId: 'mcp', action: 'deploy.production' } });
      const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(parsed.verdict).toBe('deny');
      expect(parsed.matchedPolicies).toHaveLength(1);
    });
  });

  describe('query_policy tool', () => {
    it('returns policy rules', async () => {
      const { client } = await createTestClient(deps);
      const result = await client.callTool({ name: 'query_policy', arguments: {} });
      const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(parsed.rules).toHaveLength(1);
      expect(parsed.rules[0].name).toBe('block-deploy');
    });
  });

  describe('list_policy_rules tool', () => {
    it('returns all policy rules', async () => {
      const { client } = await createTestClient(deps);
      const result = await client.callTool({ name: 'list_policy_rules', arguments: {} });
      const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(parsed.rules).toHaveLength(1);
      expect(parsed.count).toBe(1);
    });
  });

  describe('explain_decision tool', () => {
    it('returns records for known correlation ID', async () => {
      const { client } = await createTestClient(deps);
      const result = await client.callTool({ name: 'explain_decision', arguments: { correlationId: 'corr-123' } });
      const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(parsed.correlationId).toBe('corr-123');
      expect(parsed.records).toHaveLength(1);
    });

    it('returns empty records for unknown correlation ID', async () => {
      const { client } = await createTestClient(deps);
      const result = await client.callTool({ name: 'explain_decision', arguments: { correlationId: 'unknown' } });
      const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(parsed.records).toHaveLength(0);
    });
  });

  describe('audit_trail tool', () => {
    it('returns decision records', async () => {
      const { client } = await createTestClient(deps);
      const result = await client.callTool({ name: 'audit_trail', arguments: {} });
      const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0].surface).toBe('mcp');
    });
  });

  describe('ingest_policy tool', () => {
    it('creates a new policy rule', async () => {
      const { client } = await createTestClient(deps);
      const result = await client.callTool({
        name: 'ingest_policy',
        arguments: {
          name: 'new-rule',
          actionTypePattern: 'test.*',
          description: 'Test rule',
        },
      });
      const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(parsed.id).toBe('rule-new');
      expect(parsed.name).toBe('new-rule');
    });
  });

  describe('compile_rules tool', () => {
    it('compiles clauses when compiler available', async () => {
      const { client } = await createTestClient(deps);
      const result = await client.callTool({ name: 'compile_rules', arguments: { clauseIds: ['clause-1', 'clause-2'] } });
      const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(parsed.compiled).toBe(2);
    });

    it('returns error when compiler not configured', async () => {
      const noDeps = { ...deps, ruleCompiler: undefined };
      const { client } = await createTestClient(noDeps);
      const result = await client.callTool({ name: 'compile_rules', arguments: { clauseIds: ['clause-1'] } });
      const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(parsed.error).toBe('Rule compiler not configured');
    });
  });

  describe('error handling', () => {
    it('returns structured error when evaluator throws', async () => {
      const errorDeps: McpServerDeps = {
        ...deps,
        policyEvaluator: {
          async evaluate() {
            throw new Error('PDP unavailable');
          },
        },
      };
      const { client } = await createTestClient(errorDeps);
      const result = await client.callTool({ name: 'evaluate', arguments: { surfaceId: 'mcp', action: 'test' } });
      const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(parsed.error).toBe('PDP unavailable');
    });
  });
});
