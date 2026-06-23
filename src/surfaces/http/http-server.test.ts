/**
 * HTTP API Server Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHttpServer, type HttpServerInstance } from './http-server.js';
import type { HttpServerDeps } from './types.js';
import type { TenantId } from '../../contracts/common.contracts.js';

function createMockDeps(onEvaluate?: (context: Record<string, unknown> | undefined) => void): HttpServerDeps {
  return {
    tenantId: 'test-tenant',
    policyEvaluator: {
      async evaluate(_tenantId, _surfaceId, action, _context) {
        onEvaluate?.(_context);
        return {
          verdict: 'allow' as const,
          matchedPolicies: [
            { ruleId: 'r1', ruleName: 'Test Rule', verdict: 'allow', reason: `Allowed: ${action}` },
          ],
        };
      },
    },
    policyRuleRepo: {
      async findAll(_tenantId: TenantId, _filters?) {
        return [
          {
            id: 'rule-1',
            tenantId: 'test-tenant',
            name: 'Test Rule',
            description: 'A test rule',
            actionTypePattern: 'file.*',
            riskClass: 'B' as const,
            enforcementPoint: 'pre_decision' as const,
            policyType: 'safety' as const,
            priority: 50,
            requiredConstraints: [],
            requireApproval: false,
            enabled: true,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ];
      },
    },
    decisionLogRepo: {
      async findAll(_tenantId: TenantId, _filters?) {
        return [
          {
            id: 'dec-1',
            tenantId: 'test-tenant',
            surface: 'http',
            toolName: 'test-tool',
            status: 'generated' as const,
            confidence: 0.9,
            latency: 42,
            input: { action: 'file.write' },
            output: { result: 'ok' },
            correlationId: 'corr-1',
            auditHash: 'hash-1',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ];
      },
      async findByCorrelationId(_tenantId: TenantId, correlationId: string) {
        return [
          {
            id: 'dec-1',
            tenantId: 'test-tenant',
            surface: 'http',
            toolName: 'test-tool',
            status: 'generated' as const,
            confidence: 0.9,
            latency: 42,
            input: { action: 'file.write' },
            output: { result: 'ok' },
            correlationId,
            auditHash: 'hash-1',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ];
      },
    },
  };
}

const TEST_TOKEN = 'test-secret-token';

async function request(
  server: HttpServerInstance,
  method: string,
  path: string,
  options: { body?: unknown; token?: string | null } = {},
): Promise<{ status: number; data: unknown }> {
  const addr = server.address()!;
  const url = `http://${addr.host}:${addr.port}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (options.token !== null) {
    headers['Authorization'] = `Bearer ${options.token ?? TEST_TOKEN}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json();
  return { status: res.status, data };
}

describe('HTTP API Server', () => {
  let server: HttpServerInstance;
  let deps: HttpServerDeps;

  beforeEach(async () => {
    deps = createMockDeps();
    server = await createHttpServer(deps, { host: '127.0.0.1', port: 0, bearerToken: TEST_TOKEN });
  });

  afterEach(async () => {
    await server.close();
  });

  describe('GET /health', () => {
    it('returns 200 without auth', async () => {
      const { status, data } = await request(server, 'GET', '/health', { token: null });
      expect(status).toBe(200);
      expect((data as { status: string }).status).toBe('ok');
      expect((data as { data: { service: string } }).data.service).toBe('decision-core');
    });
  });

  describe('Authentication', () => {
    it('rejects requests without token', async () => {
      const { status, data } = await request(server, 'GET', '/policy', { token: null });
      expect(status).toBe(401);
      expect((data as { error: string }).error).toBe('Unauthorized');
    });

    it('rejects requests with invalid token', async () => {
      const { status, data } = await request(server, 'GET', '/policy', { token: 'wrong-token' });
      expect(status).toBe(401);
      expect((data as { error: string }).error).toBe('Unauthorized');
    });

    it('accepts requests with valid token', async () => {
      const { status } = await request(server, 'GET', '/policy');
      expect(status).toBe(200);
    });

    it('rejects invalid org-mode tokens on non-evaluate endpoints', async () => {
      await server.close();
      server = await createHttpServer(deps, {
        host: '127.0.0.1',
        port: 0,
        orgMode: true,
        identityResolver: {
          resolve(token) {
            if (token === 'valid-agent-token') {
              return { agentId: 'finance-agent', tenantId: 'test-tenant', roles: ['finance_approver'] };
            }
            return { error: 'Bearer token not recognized', code: 'unknown_token' };
          },
        },
      });

      const { status, data } = await request(server, 'GET', '/policy', { token: 'wrong-token' });
      expect(status).toBe(403);
      expect((data as { code: string }).code).toBe('unknown_token');
    });

    it('denies org-mode policy reads for non-audit agent roles', async () => {
      await server.close();
      server = await createHttpServer(deps, {
        host: '127.0.0.1',
        port: 0,
        orgMode: true,
        identityResolver: {
          resolve() {
            return { agentId: 'finance-agent', tenantId: 'test-tenant', roles: ['finance_approver'] };
          },
        },
      });

      const { status, data } = await request(server, 'GET', '/policy', { token: 'valid-agent-token' });
      expect(status).toBe(403);
      expect((data as { code: string }).code).toBe('FORBIDDEN');
    });

    it('allows org-mode policy reads for audit roles', async () => {
      await server.close();
      server = await createHttpServer(deps, {
        host: '127.0.0.1',
        port: 0,
        orgMode: true,
        identityResolver: {
          resolve() {
            return { agentId: 'compliance-agent', tenantId: 'test-tenant', roles: ['auditor'] };
          },
        },
      });

      const { status } = await request(server, 'GET', '/policy', { token: 'valid-auditor-token' });
      expect(status).toBe(200);
    });
  });

  describe('POST /evaluate', () => {
    it('evaluates policy and returns verdict', async () => {
      const { status, data } = await request(server, 'POST', '/evaluate', {
        body: { surfaceId: 'http', action: 'file.write', context: { path: '/tmp/test' } },
      });
      expect(status).toBe(200);
      const response = data as { status: string; data: { verdict: string } };
      expect(response.status).toBe('ok');
      expect(response.data.verdict).toBe('allow');
    });

    it('returns 400 for missing fields', async () => {
      const { status, data } = await request(server, 'POST', '/evaluate', {
        body: { surfaceId: 'http' },
      });
      expect(status).toBe(400);
      expect((data as { error: string }).error).toContain('Missing required fields');
    });

    it('injects token-bound org identity into evaluation context', async () => {
      await server.close();

      const seenContexts: Array<Record<string, unknown> | undefined> = [];
      deps = createMockDeps((context) => seenContexts.push(context));
      server = await createHttpServer(deps, {
        host: '127.0.0.1',
        port: 0,
        orgMode: true,
        identityResolver: {
          resolve(token, bodyAgentId) {
            if (token !== 'valid-agent-token') {
              return { error: 'Bearer token not recognized', code: 'unknown_token' };
            }
            if (bodyAgentId && bodyAgentId !== 'finance-agent') {
              return { error: 'Agent mismatch', code: 'agent_mismatch' };
            }
            return { agentId: 'finance-agent', tenantId: 'test-tenant', roles: ['finance_approver'] };
          },
        },
      });

      const { status } = await request(server, 'POST', '/evaluate', {
        token: 'valid-agent-token',
        body: { surfaceId: 'http', action: 'finance.transfer', context: { amount: 100 } },
      });

      expect(status).toBe(200);
      expect(seenContexts[0]).toMatchObject({
        agentId: 'finance-agent',
        callerRoles: ['finance_approver'],
        amount: 100,
      });
    });

    it('rejects request body agentId spoofing in org mode', async () => {
      await server.close();
      server = await createHttpServer(deps, {
        host: '127.0.0.1',
        port: 0,
        orgMode: true,
        identityResolver: {
          resolve(token, bodyAgentId) {
            if (token !== 'valid-agent-token') {
              return { error: 'Bearer token not recognized', code: 'unknown_token' };
            }
            if (bodyAgentId && bodyAgentId !== 'finance-agent') {
              return { error: 'Agent mismatch', code: 'agent_mismatch' };
            }
            return { agentId: 'finance-agent', tenantId: 'test-tenant', roles: ['finance_approver'] };
          },
        },
      });

      const { status, data } = await request(server, 'POST', '/evaluate', {
        token: 'valid-agent-token',
        body: { surfaceId: 'http', action: 'finance.transfer', agentId: 'ceo-agent' },
      });

      expect(status).toBe(403);
      expect((data as { code: string }).code).toBe('agent_mismatch');
    });
  });

  describe('POST /record', () => {
    it('queries records by correlationId', async () => {
      const { status, data } = await request(server, 'POST', '/record', {
        body: { correlationId: 'corr-1' },
      });
      expect(status).toBe(200);
      const response = data as { status: string; data: { correlationId: string; records: unknown[] } };
      expect(response.data.correlationId).toBe('corr-1');
      expect(response.data.records).toHaveLength(1);
    });

    it('queries all records with filters', async () => {
      const { status, data } = await request(server, 'POST', '/record', {
        body: { surface: 'http' },
      });
      expect(status).toBe(200);
      const response = data as { status: string; data: { records: unknown[]; count: number } };
      expect(response.data.count).toBe(1);
    });
  });

  describe('GET /policy', () => {
    it('returns policy rules', async () => {
      const { status, data } = await request(server, 'GET', '/policy');
      expect(status).toBe(200);
      const response = data as { status: string; data: { rules: unknown[]; count: number } };
      expect(response.data.rules).toHaveLength(1);
      expect(response.data.count).toBe(1);
    });
  });

  describe('GET /clauses', () => {
    it('returns clauses list', async () => {
      const { status, data } = await request(server, 'GET', '/clauses');
      expect(status).toBe(200);
      const response = data as { status: string; data: { clauses: unknown[]; count: number } };
      expect(response.data.clauses).toHaveLength(1);
      expect(response.data.count).toBe(1);
    });
  });

  describe('GET /audit', () => {
    it('returns audit trail', async () => {
      const { status, data } = await request(server, 'GET', '/audit');
      expect(status).toBe(200);
      const response = data as { status: string; data: { records: unknown[]; count: number } };
      expect(response.data.records).toHaveLength(1);
    });
  });

  describe('Error handling', () => {
    it('returns 404 for unknown routes', async () => {
      const { status, data } = await request(server, 'GET', '/unknown');
      expect(status).toBe(404);
      expect((data as { error: string }).error).toBe('Not found');
    });

    it('returns 400 for invalid JSON body', async () => {
      const addr = server.address()!;
      const url = `http://${addr.host}:${addr.port}/evaluate`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TEST_TOKEN}`, 'Content-Type': 'application/json' },
        body: 'not-json{{{',
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid JSON body');
    });
  });

  describe('Server binding', () => {
    it('binds to 127.0.0.1 by default', () => {
      const addr = server.address()!;
      expect(addr.host).toBe('127.0.0.1');
    });
  });
});
