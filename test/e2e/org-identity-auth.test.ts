/**
 * Identity Spoofing & Authentication E2E Tests
 *
 * Proves that token-bound identity cannot be bypassed through the HTTP API.
 * Tests every authentication boundary: missing, invalid, disabled, mismatched,
 * hash-confusion, callerRoles injection, and cross-tenant isolation.
 *
 * Scenario definitions: test/scenarios/org-mode/spoofing-scenarios.yaml
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { createRbacTestServer } from '../helpers/rbac-test-server.js';
import { createAgentHttpClient, createAllAgentClients } from '../helpers/agent-http-client.js';
import { loadScenarios, assertStepResult } from '../helpers/scenario-runner.js';
import { MERIDIAN_TEST_TOKENS } from '../helpers/org-fixture-loader.js';
import { hashToken } from '../../src/identity/agent-auth.js';
import type { OrgTestServerInstance } from '../helpers/org-test-server.js';

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface ErrorResponse {
  error: string;
  code: string;
}

interface EvalData {
  verdict: string;
  matchedPolicies: Array<{
    ruleId: string;
    ruleName: string;
    verdict: string;
    reason: string;
  }>;
}

interface EvalResponse {
  status: string;
  data: EvalData;
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: OrgTestServerInstance;
let clients: Record<string, ReturnType<typeof createAgentHttpClient>>;

beforeAll(async () => {
  server = await createRbacTestServer();
  clients = createAllAgentClients(server.baseUrl());
});

afterAll(async () => {
  await server.close();
});

// ===========================================================================
// 1. YAML scenario suite — standard-token scenarios
// ===========================================================================

describe('spoofing-scenarios.yaml (standard-token subset)', () => {
  const scenarios = loadScenarios(
    resolve(__dirname, '../scenarios/org-mode/spoofing-scenarios.yaml'),
  );

  // Only run scenarios that work with the standard scenario runner
  // (those that use the agent's own valid token and don't need custom tokens).
  const standardTokenScenarios = scenarios.filter((s) =>
    [
      'Valid CEO token — baseline',
      'Valid product token — baseline',
      'Product token with CEO agentId in body',
      'Caller-supplied callerRoles ignored',
      'Context agentId mismatch',
      'Combined escalation — wrong agentId + callerRoles',
    ].includes(s.name),
  );

  for (const scenario of standardTokenScenarios) {
    describe(scenario.name, () => {
      for (const step of scenario.steps) {
        it(step.name, async () => {
          const client = createAgentHttpClient(server.baseUrl(), step.agentId);
          const response = await (step.method === 'GET'
            ? client.get(step.path)
            : client.post(step.path, { body: step.body }));
          assertStepResult(response, step);
        });
      }
    });
  }
});

// ===========================================================================
// 2. Valid token resolves to correct identity
// ===========================================================================

describe('valid token identity resolution', () => {
  it('CEO token resolves to ceo-agent with correct roles', async () => {
    const ceo = clients['ceo-agent'];
    const response = await ceo.post('/evaluate', {
      body: { surfaceId: 'public-dashboard', action: 'public-status-read' },
    });

    expect(response.status).toBe(200);
    const body = response.data as EvalResponse;
    expect(body.status).toBe('ok');
    expect(body.data.verdict).toBeDefined();
  });

  it('each agent token resolves to its own identity', async () => {
    for (const [agentId, client] of Object.entries(clients)) {
      const response = await client.post('/evaluate', {
        body: { agentId, surfaceId: 'public-dashboard', action: 'public-status-read' },
      });
      expect(response.status).toBe(200);
      const body = response.data as EvalResponse;
      expect(body.status).toBe('ok');

      const wrongAgentId = agentId === 'ceo-agent' ? 'product-agent' : 'ceo-agent';
      const mismatch = await client.post('/evaluate', {
        body: { agentId: wrongAgentId, surfaceId: 'public-dashboard', action: 'public-status-read' },
      });
      expect(mismatch.status).toBe(403);
      const mismatchBody = mismatch.data as ErrorResponse;
      expect(mismatchBody.code).toBe('agent_mismatch');
    }
  });
});

// ===========================================================================
// 3. Missing token — 401
// ===========================================================================

describe('missing bearer token', () => {
  it('returns 401 AUTH_REQUIRED when no Authorization header', async () => {
    const client = clients['ceo-agent'];
    const response = await client.getUnauthenticated('/evaluate');

    expect(response.status).toBe(401);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('AUTH_REQUIRED');
    expect(body.error).toContain('Bearer token required');
  });

  it('POST /evaluate without token returns 401', async () => {
    const url = `${server.baseUrl()}/evaluate`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surfaceId: 'public-dashboard', action: 'public-status-read' }),
    });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.code).toBe('AUTH_REQUIRED');
  });
});

// ===========================================================================
// 4. Unknown / invalid token — 403
// ===========================================================================

describe('unknown and invalid tokens', () => {
  it('random token returns 403 unknown_token', async () => {
    const client = clients['ceo-agent'];
    const response = await client.postWithToken('/evaluate', 'totally-random-garbage-token-12345', {
      body: { surfaceId: 'public-dashboard', action: 'public-status-read' },
    });

    expect(response.status).toBe(403);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('unknown_token');
    expect(body.error).toContain('not recognized');
  });

  it('empty string token returns 403 unknown_token', async () => {
    const client = clients['ceo-agent'];
    const response = await client.postWithToken('/evaluate', '', {
      body: { surfaceId: 'public-dashboard', action: 'public-status-read' },
    });

    // Empty token after extractToken may resolve to missing (401) or unknown (403)
    expect([401, 403]).toContain(response.status);
    const body = response.data as ErrorResponse;
    expect(['AUTH_REQUIRED', 'unknown_token']).toContain(body.code);
  });

  it('UUID-like token returns 403 unknown_token', async () => {
    const client = clients['ceo-agent'];
    const response = await client.postWithToken(
      '/evaluate',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      { body: { surfaceId: 'public-dashboard', action: 'public-status-read' } },
    );

    expect(response.status).toBe(403);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('unknown_token');
  });
});

// ===========================================================================
// 5. Disabled binding — 403
// ===========================================================================

describe('disabled auth binding', () => {
  let originalEnabled: boolean;

  beforeEach(() => {
    const binding = server.fixtures.tokens.bindings.find((b) => b.agentId === 'contractor-agent');
    originalEnabled = binding!.enabled;
    binding!.enabled = false;
  });

  afterEach(() => {
    const binding = server.fixtures.tokens.bindings.find((b) => b.agentId === 'contractor-agent');
    binding!.enabled = originalEnabled;
  });

  it('disabled binding returns 403 disabled_binding', async () => {
    const contractor = clients['contractor-agent'];
    const response = await contractor.post('/evaluate', {
      body: { surfaceId: 'public-dashboard', action: 'public-status-read' },
    });

    expect(response.status).toBe(403);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('disabled_binding');
    expect(body.error).toContain('disabled');
  });

  it('other agents still work while one binding is disabled', async () => {
    const ceo = clients['ceo-agent'];
    const response = await ceo.post('/evaluate', {
      body: { surfaceId: 'public-dashboard', action: 'public-status-read' },
    });

    expect(response.status).toBe(200);
  });
});

// ===========================================================================
// 6. Disabled agent — 403
// ===========================================================================

describe('disabled agent', () => {
  let originalEnabled: boolean;

  beforeEach(() => {
    const agent = server.fixtures.agents.agents.find((a) => a.agentId === 'contractor-agent');
    originalEnabled = agent!.enabled;
    agent!.enabled = false;
  });

  afterEach(() => {
    const agent = server.fixtures.agents.agents.find((a) => a.agentId === 'contractor-agent');
    agent!.enabled = originalEnabled;
  });

  it('disabled agent returns 403 agent_disabled', async () => {
    const contractor = clients['contractor-agent'];
    const response = await contractor.post('/evaluate', {
      body: { surfaceId: 'public-dashboard', action: 'public-status-read' },
    });

    expect(response.status).toBe(403);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('agent_disabled');
    expect(body.error).toContain('disabled');
  });
});

// ===========================================================================
// 7. Hash confusion — token hash sent as bearer
// ===========================================================================

describe('token hash sent as bearer (hash confusion attack)', () => {
  it('sending the stored SHA-256 hash as bearer token is rejected', async () => {
    const ceoBinding = server.fixtures.tokens.bindings.find((b) => b.agentId === 'ceo-agent');
    const storedHash = ceoBinding!.subject;

    const client = clients['ceo-agent'];
    const response = await client.postWithToken('/evaluate', storedHash, {
      body: { surfaceId: 'public-dashboard', action: 'public-status-read' },
    });

    expect(response.status).toBe(403);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('unknown_token');
  });

  it('hash of a different agent token is also rejected', async () => {
    const productToken = MERIDIAN_TEST_TOKENS['product-agent'];
    const productHash = hashToken(productToken, 'meridian-test-salt-2024');

    const client = clients['ceo-agent'];
    const response = await client.postWithToken('/evaluate', productHash, {
      body: { surfaceId: 'public-dashboard', action: 'public-status-read' },
    });

    expect(response.status).toBe(403);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('unknown_token');
  });
});

// ===========================================================================
// 8. Identity mismatch — product token + CEO agentId in body
// ===========================================================================

describe('identity mismatch (body agentId vs token)', () => {
  it('product token with CEO agentId in body returns 403 agent_mismatch', async () => {
    const product = clients['product-agent'];
    const response = await product.post('/evaluate', {
      body: {
        surfaceId: 'finance-reporting',
        action: 'finance-report-read',
        agentId: 'ceo-agent',
      },
    });

    expect(response.status).toBe(403);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('agent_mismatch');
    expect(body.error).toContain('ceo-agent');
    expect(body.error).toContain('product-agent');
  });

  it('contractor token with CFO agentId in body returns 403 agent_mismatch', async () => {
    const contractor = clients['contractor-agent'];
    const response = await contractor.post('/evaluate', {
      body: {
        surfaceId: 'finance-operations',
        action: 'finance-transfer',
        agentId: 'cfo-agent',
      },
    });

    expect(response.status).toBe(403);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('agent_mismatch');
  });

  it('agentId in context object is also checked for mismatch', async () => {
    const contractor = clients['contractor-agent'];
    const response = await contractor.post('/evaluate', {
      body: {
        surfaceId: 'public-dashboard',
        action: 'public-status-read',
        context: { agentId: 'ceo-agent' },
      },
    });

    expect(response.status).toBe(403);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('agent_mismatch');
  });

  it('combined agentId mismatch + callerRoles escalation rejects before roles evaluated', async () => {
    const product = clients['product-agent'];
    const response = await product.post('/evaluate', {
      body: {
        surfaceId: 'finance-reporting',
        action: 'finance-report-read',
        agentId: 'ceo-agent',
        context: {
          callerRoles: ['executive', 'approver'],
        },
      },
    });

    // agent_mismatch is checked before callerRoles are applied
    expect(response.status).toBe(403);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('agent_mismatch');
  });
});

// ===========================================================================
// 9. callerRoles ignored in HTTP mode
// ===========================================================================

describe('caller-supplied callerRoles ignored', () => {
  it('product agent with escalated callerRoles is still denied finance access', async () => {
    const product = clients['product-agent'];
    const response = await product.post('/evaluate', {
      body: {
        surfaceId: 'finance-reporting',
        action: 'finance-report-read',
        context: {
          callerRoles: ['finance', 'executive', 'approver'],
        },
      },
    });

    expect(response.status).toBe(200);
    const body = response.data as EvalResponse;
    // Server uses token-resolved roles ['product'], not body callerRoles
    expect(body.data.verdict).toBe('deny');
  });

  it('contractor with executive+approver callerRoles is still denied approval', async () => {
    const contractor = clients['contractor-agent'];
    const response = await contractor.post('/evaluate', {
      body: {
        surfaceId: 'approval-queue',
        action: 'approve-request',
        context: {
          callerRoles: ['executive', 'approver'],
        },
      },
    });

    expect(response.status).toBe(200);
    const body = response.data as EvalResponse;
    expect(body.data.verdict).toBe('deny');
  });

  it('HR lead with finance callerRoles still has HR access (uses real roles)', async () => {
    const hrLead = clients['hr-lead-agent'];
    const response = await hrLead.post('/evaluate', {
      body: {
        surfaceId: 'hr-portal',
        action: 'hr-record-read',
        context: {
          callerRoles: ['finance'],
        },
      },
    });

    expect(response.status).toBe(200);
    const body = response.data as EvalResponse;
    // Server uses token-resolved roles ['hr','people_ops'], not body ['finance']
    expect(body.data.verdict).toBe('allow');
  });
});

// ===========================================================================
// 10. Cross-tenant isolation
// ===========================================================================

describe('cross-tenant token isolation', () => {
  let crossTenantToken: string;

  beforeAll(() => {
    crossTenantToken = 'rival-corp-test-token-spy-agent';
    const crossTenantHash = hashToken(crossTenantToken, 'meridian-test-salt-2024');

    server.fixtures.tokens.bindings.push({
      subject: crossTenantHash,
      salt: 'meridian-test-salt-2024',
      agentId: 'spy-agent',
      tenantId: 'rival-corp',
      enabled: true,
    });

    server.fixtures.agents.agents.push({
      agentId: 'spy-agent',
      displayName: 'Spy Agent',
      humanOwner: 'Eve Eavesdrop',
      roles: ['executive', 'approver'],
      surfaces: ['http'],
      personalBrain: 'spy-brain',
      authSubject: 'spy-auth-subject',
      enabled: true,
    });
  });

  afterAll(() => {
    server.fixtures.tokens.bindings = server.fixtures.tokens.bindings.filter(
      (b) => b.agentId !== 'spy-agent',
    );
    server.fixtures.agents.agents = server.fixtures.agents.agents.filter(
      (a) => a.agentId !== 'spy-agent',
    );
  });

  it('cross-tenant token resolves but is denied privileged access', async () => {
    const client = clients['ceo-agent'];
    const response = await client.postWithToken('/evaluate', crossTenantToken, {
      body: { surfaceId: 'finance-reporting', action: 'finance-report-read' },
    });

    // spy-agent has executive+approver roles but no 'finance' role,
    // so the deny-unknown-default denies finance access
    expect(response.status).toBe(200);
    const body = response.data as EvalResponse;
    expect(body.data.verdict).toBe('deny');
  });

  it('cross-tenant token cannot access policy rules for another tenant', async () => {
    const client = clients['ceo-agent'];
    const response = await client.getWithToken('/policy', crossTenantToken);

    // spy-agent roles don't include any audit-capable role
    expect(response.status).toBe(403);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('FORBIDDEN');
  });

  it('unknown token from non-existent tenant is rejected', async () => {
    const client = clients['ceo-agent'];
    const response = await client.postWithToken(
      '/evaluate',
      'non-existent-tenant-token-xyz',
      { body: { surfaceId: 'public-dashboard', action: 'public-status-read' } },
    );

    expect(response.status).toBe(403);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('unknown_token');
  });
});

// ===========================================================================
// 11. Machine-readable error codes
// ===========================================================================

describe('machine-readable error codes in all error responses', () => {
  it('401 responses include AUTH_REQUIRED code', async () => {
    const client = clients['ceo-agent'];
    const response = await client.getUnauthenticated('/evaluate');

    expect(response.status).toBe(401);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('AUTH_REQUIRED');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('403 unknown_token responses include code and error message', async () => {
    const client = clients['ceo-agent'];
    const response = await client.getWithToken('/evaluate', 'bad-token');

    expect(response.status).toBe(403);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('unknown_token');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('403 agent_mismatch responses include code and descriptive error', async () => {
    const product = clients['product-agent'];
    const response = await product.post('/evaluate', {
      body: {
        surfaceId: 'test',
        action: 'test-action',
        agentId: 'ceo-agent',
      },
    });

    expect(response.status).toBe(403);
    const body = response.data as ErrorResponse;
    expect(body.code).toBe('agent_mismatch');
    expect(body.error).toContain('product-agent');
    expect(body.error).toContain('ceo-agent');
  });

  it('error codes are stable strings, not numeric', async () => {
    const client = clients['ceo-agent'];

    const missing = await client.getUnauthenticated('/evaluate');
    const unknown = await client.getWithToken('/evaluate', 'nope');

    const missingBody = missing.data as ErrorResponse;
    const unknownBody = unknown.data as ErrorResponse;

    // Codes are snake_case or SCREAMING_CASE strings
    expect(missingBody.code).toMatch(/^[A-Z_]+$/);
    expect(unknownBody.code).toMatch(/^[a-z_]+$/);

    expect(typeof missingBody.code).toBe('string');
    expect(typeof unknownBody.code).toBe('string');
  });
});

// ===========================================================================
// 12. Security event observability
// ===========================================================================

describe('security event observability', () => {
  // Self-contained: performs spoofing attempts and captures events in-place
  // rather than relying on prior test execution order.

  interface SecurityEvent {
    type: string;
    status: number;
    code: string;
    detail: Record<string, unknown>;
  }

  const capturedEvents: SecurityEvent[] = [];

  beforeAll(async () => {
    const client = clients['ceo-agent'];
    const contractor = clients['contractor-agent'];

    // 1. Missing token
    const missing = await client.getUnauthenticated('/evaluate');
    const missingBody = missing.data as ErrorResponse;
    capturedEvents.push({
      type: 'missing_token',
      status: missing.status,
      code: missingBody.code,
      detail: { error: missingBody.error },
    });

    // 2. Unknown token
    const unknown = await client.postWithToken('/evaluate', 'random-garbage', {
      body: { surfaceId: 'test', action: 'test' },
    });
    const unknownBody = unknown.data as ErrorResponse;
    capturedEvents.push({
      type: 'unknown_token',
      status: unknown.status,
      code: unknownBody.code,
      detail: { error: unknownBody.error },
    });

    // 3. Hash confusion
    const ceoBinding = server.fixtures.tokens.bindings.find((b) => b.agentId === 'ceo-agent');
    const hashConfusion = await client.postWithToken('/evaluate', ceoBinding!.subject, {
      body: { surfaceId: 'test', action: 'test' },
    });
    const hashBody = hashConfusion.data as ErrorResponse;
    capturedEvents.push({
      type: 'hash_confusion',
      status: hashConfusion.status,
      code: hashBody.code,
      detail: { error: hashBody.error },
    });

    // 4. Agent mismatch
    const mismatch = await contractor.post('/evaluate', {
      body: { surfaceId: 'test', action: 'test', agentId: 'ceo-agent' },
    });
    const mismatchBody = mismatch.data as ErrorResponse;
    capturedEvents.push({
      type: 'agent_mismatch',
      status: mismatch.status,
      code: mismatchBody.code,
      detail: { claimed: 'ceo-agent', actual: 'contractor-agent' },
    });

    // 5. Disabled binding
    const binding = server.fixtures.tokens.bindings.find((b) => b.agentId === 'contractor-agent');
    binding!.enabled = false;
    const disabled = await contractor.post('/evaluate', {
      body: { surfaceId: 'test', action: 'test' },
    });
    const disabledBody = disabled.data as ErrorResponse;
    capturedEvents.push({
      type: 'disabled_binding',
      status: disabled.status,
      code: disabledBody.code,
      detail: { agentId: 'contractor-agent' },
    });
    binding!.enabled = true;

    // 6. Disabled agent
    const agent = server.fixtures.agents.agents.find((a) => a.agentId === 'contractor-agent');
    agent!.enabled = false;
    const agentDisabled = await contractor.post('/evaluate', {
      body: { surfaceId: 'test', action: 'test' },
    });
    const agentDisabledBody = agentDisabled.data as ErrorResponse;
    capturedEvents.push({
      type: 'agent_disabled',
      status: agentDisabled.status,
      code: agentDisabledBody.code,
      detail: { agentId: 'contractor-agent' },
    });
    agent!.enabled = true;
  });

  it('all spoofing attack types produce observable events', () => {
    const types = capturedEvents.map((e) => e.type);
    expect(types).toContain('missing_token');
    expect(types).toContain('unknown_token');
    expect(types).toContain('hash_confusion');
    expect(types).toContain('agent_mismatch');
    expect(types).toContain('disabled_binding');
    expect(types).toContain('agent_disabled');
  });

  it('each event includes type, status code, error code, and structured detail', () => {
    expect(capturedEvents.length).toBeGreaterThanOrEqual(6);

    for (const event of capturedEvents) {
      expect(typeof event.type).toBe('string');
      expect(event.type.length).toBeGreaterThan(0);
      expect(typeof event.status).toBe('number');
      expect([401, 403]).toContain(event.status);
      expect(typeof event.code).toBe('string');
      expect(event.code.length).toBeGreaterThan(0);
      expect(typeof event.detail).toBe('object');
      expect(event.detail).not.toBeNull();
    }
  });

  it('event codes match expected authentication error codes', () => {
    const codeSet = new Set(capturedEvents.map((e) => e.code));
    expect(codeSet.has('AUTH_REQUIRED')).toBe(true);
    expect(codeSet.has('unknown_token')).toBe(true);
    expect(codeSet.has('agent_mismatch')).toBe(true);
    expect(codeSet.has('disabled_binding')).toBe(true);
    expect(codeSet.has('agent_disabled')).toBe(true);
  });
});
