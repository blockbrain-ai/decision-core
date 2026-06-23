/**
 * MCP Server Tests
 *
 * Tests for tool registration, auth validation, and error handling.
 */

import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, validateBearerToken } from './mcp-server.js';
import type { McpServerDeps } from './types.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyRule, PolicyRuleCreateInput } from '../../contracts/policy.contracts.js';
import type { DecisionRecord } from '../../contracts/decision.contracts.js';

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
            verdict: 'deny',
            matchedPolicies: [{
              ruleId: 'rule-1',
              ruleName: 'block-deploy',
              verdict: 'deny',
              reason: 'Production deploys require approval',
            }],
          };
        }
        return { verdict: 'allow', matchedPolicies: [] };
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
  };
}

describe('MCP Server', () => {
  describe('createMcpServer', () => {
    it('creates server instance', () => {
      const deps = createMockDeps();
      const server = createMcpServer(deps);
      expect(server).toBeDefined();
    });

    it('accepts custom name and version', () => {
      const deps = createMockDeps();
      const server = createMcpServer(deps, { name: 'custom', version: '1.0.0' });
      expect(server).toBeDefined();
    });

    it('registers agent-led setup tools', async () => {
      const deps = createMockDeps();
      const server = createMcpServer(deps);
      const client = new Client({ name: 'test-client', version: '0.0.1' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      await server.connect(serverTransport);
      await client.connect(clientTransport);

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
  });

  describe('validateBearerToken', () => {
    it('returns true when no token configured', () => {
      expect(validateBearerToken(undefined, undefined)).toBe(true);
      expect(validateBearerToken('Bearer xyz', undefined)).toBe(true);
    });

    it('returns false when token configured but no header', () => {
      expect(validateBearerToken(undefined, 'secret')).toBe(false);
    });

    it('returns false when token does not match', () => {
      expect(validateBearerToken('Bearer wrong', 'secret')).toBe(false);
    });

    it('returns true when token matches with Bearer prefix', () => {
      expect(validateBearerToken('Bearer secret', 'secret')).toBe(true);
    });

    it('returns true when token matches without prefix', () => {
      expect(validateBearerToken('secret', 'secret')).toBe(true);
    });
  });
});
