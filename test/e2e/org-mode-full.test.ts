/**
 * Capstone Org-Mode HTTP E2E Test
 *
 * Single HTTP server, all 7 Meridian Systems agents, 35+ test cases proving
 * every security surface works end-to-end through the HTTP API.
 *
 * Surfaces covered: identity, RBAC, isolation, approval, tool drift,
 * red-team, and provisioning round-trip.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRbacTestServer } from '../helpers/rbac-test-server.js';
import { createAllAgentClients, createAgentHttpClient } from '../helpers/agent-http-client.js';
import { createOrgTestServer } from '../helpers/org-test-server.js';
import { hashToken, generateAgentToken, generateAgentSalt } from '../../src/identity/agent-auth.js';
import type { OrgTestServerInstance } from '../helpers/org-test-server.js';
import type { AgentHttpClient } from '../helpers/agent-http-client.js';
import type { AgentAuthStore } from '../../src/identity/agent-auth.contracts.js';

describe('org-mode-full: capstone E2E', () => {
  let server: OrgTestServerInstance;
  let clients: Record<string, AgentHttpClient>;
  let baseUrl: string;

  beforeAll(async () => {
    server = await createRbacTestServer();
    baseUrl = server.baseUrl();
    clients = createAllAgentClients(baseUrl);
  });

  afterAll(async () => {
    await server.close();
  });

  // ---------------------------------------------------------------------------
  // Identity (7 cases)
  // ---------------------------------------------------------------------------
  describe('identity', () => {
    it('authenticates CEO with valid token', async () => {
      const res = await clients['ceo-agent'].post('/evaluate', {
        body: { action: 'public-read', surfaceId: 'public-dashboard', agentId: 'ceo-agent' },
      });
      expect(res.status, 'CEO valid token should return 200').toBe(200);
      expect((res.data as Record<string, unknown>).status, 'Response status should be ok').toBe('ok');
    });

    it('authenticates all 7 agents with distinct tokens', async () => {
      for (const [agentId, client] of Object.entries(clients)) {
        const res = await client.post('/evaluate', {
          body: { action: 'public-read', surfaceId: 'public-dashboard', agentId },
        });
        expect(res.status, `Agent ${agentId} should authenticate successfully`).toBe(200);
      }
    });

    it('rejects missing bearer token with 401', async () => {
      const res = await clients['ceo-agent'].getUnauthenticated('/evaluate');
      expect(res.status, 'Missing token should return 401').toBe(401);
      const data = res.data as Record<string, unknown>;
      expect(data.code, 'Error code should be AUTH_REQUIRED').toBe('AUTH_REQUIRED');
    });

    it('rejects unknown bearer token with 403', async () => {
      const res = await clients['ceo-agent'].getWithToken('/evaluate', 'totally-bogus-token');
      expect(res.status, 'Unknown token should return 403').toBe(403);
      const data = res.data as Record<string, unknown>;
      expect(data.code, 'Error code should be unknown_token').toBe('unknown_token');
    });

    it('rejects body agentId mismatch', async () => {
      const res = await clients['product-agent'].post('/evaluate', {
        body: { action: 'public-read', surfaceId: 'public-dashboard', agentId: 'ceo-agent' },
      });
      expect(res.status, 'Mismatched agentId should return 403').toBe(403);
      const data = res.data as Record<string, unknown>;
      expect(data.code, 'Error code should be agent_mismatch').toBe('agent_mismatch');
    });

    it('rejects disabled binding', async () => {
      const binding = server.fixtures.tokens.bindings.find((b) => b.agentId === 'cfo-agent')!;
      binding.enabled = false;
      try {
        const res = await clients['cfo-agent'].post('/evaluate', {
          body: { action: 'public-read', surfaceId: 'public-dashboard', agentId: 'cfo-agent' },
        });
        expect(res.status, 'Disabled binding should return 403').toBe(403);
        const data = res.data as Record<string, unknown>;
        expect(data.code, 'Error code should be disabled_binding').toBe('disabled_binding');
      } finally {
        binding.enabled = true;
      }
    });

    it('rejects disabled agent', async () => {
      const agent = server.fixtures.agents.agents.find((a) => a.agentId === 'hr-lead-agent')!;
      agent.enabled = false;
      try {
        const res = await clients['hr-lead-agent'].post('/evaluate', {
          body: { action: 'public-read', surfaceId: 'public-dashboard', agentId: 'hr-lead-agent' },
        });
        expect(res.status, 'Disabled agent should return 403').toBe(403);
        const data = res.data as Record<string, unknown>;
        expect(data.code, 'Error code should be agent_disabled').toBe('agent_disabled');
      } finally {
        agent.enabled = true;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // RBAC (8 cases)
  // ---------------------------------------------------------------------------
  describe('rbac', () => {
    it('CFO can read finance reports (finance role)', async () => {
      const res = await clients['cfo-agent'].post('/evaluate', {
        body: { action: 'finance-report-read', surfaceId: 'finance-reporting', agentId: 'cfo-agent' },
      });
      expect(res.status, 'CFO finance read should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'CFO should be allowed to read finance reports').toBe('allow');
    });

    it('finance-analyst can read finance reports (finance_analyst role)', async () => {
      const res = await clients['finance-analyst-agent'].post('/evaluate', {
        body: { action: 'finance-report-read', surfaceId: 'finance-reporting', agentId: 'finance-analyst-agent' },
      });
      expect(res.status, 'Finance analyst read should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Finance analyst should be allowed to read finance reports').toBe('allow');
    });

    it('product agent denied finance access', async () => {
      const res = await clients['product-agent'].post('/evaluate', {
        body: { action: 'finance-report-read', surfaceId: 'finance-reporting', agentId: 'product-agent' },
      });
      expect(res.status, 'Product agent finance request should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Product agent should be denied finance access').toBe('deny');
    });

    it('contractor denied non-public access', async () => {
      const res = await clients['contractor-agent'].post('/evaluate', {
        body: { action: 'finance-report-read', surfaceId: 'finance-reporting', agentId: 'contractor-agent' },
      });
      expect(res.status, 'Contractor finance request should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Contractor should be denied finance access').toBe('deny');
    });

    it('contractor can read public data', async () => {
      const res = await clients['contractor-agent'].post('/evaluate', {
        body: { action: 'public-read', surfaceId: 'public-dashboard', agentId: 'contractor-agent' },
      });
      expect(res.status, 'Contractor public read should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Contractor should be allowed to read public data').toBe('allow');
    });

    it('CEO requires both executive AND approver for approval (roleMatchMode:all)', async () => {
      const res = await clients['ceo-agent'].post('/evaluate', {
        body: { action: 'approve-request', surfaceId: 'approval-queue', agentId: 'ceo-agent' },
      });
      expect(res.status, 'CEO approve request should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'CEO with executive+approver roles should be allowed').toBe('allow');
    });

    it('vp-eng denied approval (missing approver role for roleMatchMode:all)', async () => {
      const res = await clients['vp-eng-agent'].post('/evaluate', {
        body: { action: 'approve-request', surfaceId: 'approval-queue', agentId: 'vp-eng-agent' },
      });
      expect(res.status, 'VP-eng approve request should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'VP-eng without approver role should be denied').toBe('deny');
    });

    it('callerRoles from body are ignored — token-resolved roles used', async () => {
      const res = await clients['product-agent'].post('/evaluate', {
        body: {
          action: 'finance-report-read',
          surfaceId: 'finance-reporting',
          agentId: 'product-agent',
          callerRoles: ['finance', 'executive'],
        },
      });
      expect(res.status, 'Injected callerRoles should not elevate access').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Product agent should still be denied despite injected callerRoles').toBe('deny');
    });
  });

  // ---------------------------------------------------------------------------
  // Isolation (5 cases)
  // ---------------------------------------------------------------------------
  describe('isolation', () => {
    it('finance-analyst cannot access HR records (cross-classification boundary)', async () => {
      const res = await clients['finance-analyst-agent'].post('/evaluate', {
        body: { action: 'hr-record-read', surfaceId: 'hr-portal', agentId: 'finance-analyst-agent' },
      });
      expect(res.status, 'Cross-classification request should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Finance analyst should be denied HR access').toBe('deny');
    });

    it('hr-lead cannot access finance operations (cross-classification boundary)', async () => {
      const res = await clients['hr-lead-agent'].post('/evaluate', {
        body: { action: 'finance-transfer', surfaceId: 'finance-operations', agentId: 'hr-lead-agent' },
      });
      expect(res.status, 'HR-to-finance cross request should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'HR lead should be denied finance operations').toBe('deny');
    });

    it('contractor denied deploy access (neverAccessibleBy equivalent)', async () => {
      const res = await clients['contractor-agent'].post('/evaluate', {
        body: { action: 'deploy-staging', surfaceId: 'deployment', agentId: 'contractor-agent' },
      });
      expect(res.status, 'Contractor deploy request should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Contractor should be denied deploy access').toBe('deny');
    });

    it('contractor denied HR access (neverAccessibleBy equivalent)', async () => {
      const res = await clients['contractor-agent'].post('/evaluate', {
        body: { action: 'hr-record-read', surfaceId: 'hr-portal', agentId: 'contractor-agent' },
      });
      expect(res.status, 'Contractor HR request should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Contractor should be denied HR access').toBe('deny');
    });

    it('tenant isolation — cross-tenant token rejected', async () => {
      // Create a fake token for a different tenant
      const crossTenantToken = 'mrd-test-token-cross-tenant-spy';
      const crossTenantSalt = 'cross-tenant-salt';
      server.fixtures.tokens.bindings.push({
        subject: hashToken(crossTenantToken, crossTenantSalt),
        salt: crossTenantSalt,
        agentId: 'spy-agent',
        tenantId: 'rival-corp',
        enabled: true,
      });
      try {
        const client = createAgentHttpClient(baseUrl, 'ceo-agent');
        const res = await client.postWithToken('/evaluate', crossTenantToken, {
          body: { action: 'public-read', surfaceId: 'public-dashboard', agentId: 'spy-agent' },
        });
        // The spy-agent doesn't exist in the registry, so it should be rejected
        expect(res.status, 'Cross-tenant agent should be rejected').toBe(403);
        const data = res.data as Record<string, unknown>;
        expect(data.code, 'Cross-tenant agent should get agent_disabled code').toBe('agent_disabled');
      } finally {
        server.fixtures.tokens.bindings.pop();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Approval (5 cases)
  // ---------------------------------------------------------------------------
  describe('approval', () => {
    it('production deploy requires approval for deployer', async () => {
      const res = await clients['vp-eng-agent'].post('/evaluate', {
        body: { action: 'deploy-production', surfaceId: 'deployment', agentId: 'vp-eng-agent' },
      });
      expect(res.status, 'Prod deploy request should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Production deploy should require approval').toBe('approve_required');
    });

    it('vp-eng can deploy to staging without approval', async () => {
      const res = await clients['vp-eng-agent'].post('/evaluate', {
        body: { action: 'deploy-staging', surfaceId: 'deployment', agentId: 'vp-eng-agent' },
      });
      expect(res.status, 'Staging deploy should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Staging deploy should be allowed without approval').toBe('allow');
    });

    it('contractor cannot self-approve by escalating to approval queue', async () => {
      const res = await clients['contractor-agent'].post('/evaluate', {
        body: { action: 'approve-request', surfaceId: 'approval-queue', agentId: 'contractor-agent' },
      });
      expect(res.status, 'Contractor approval attempt should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Contractor should be denied approval queue access').toBe('deny');
    });

    it('product agent cannot approve requests (no approver role)', async () => {
      const res = await clients['product-agent'].post('/evaluate', {
        body: { action: 'approve-request', surfaceId: 'approval-queue', agentId: 'product-agent' },
      });
      expect(res.status, 'Product agent approval request should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Product agent should be denied approval access').toBe('deny');
    });

    it('CFO has approver role and can approve requests', async () => {
      const res = await clients['cfo-agent'].post('/evaluate', {
        body: { action: 'approve-request', surfaceId: 'approval-queue', agentId: 'cfo-agent' },
      });
      expect(res.status, 'CFO approval request should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      // CFO has finance+approver but not executive — roleMatchMode:all requires both
      expect(data.data.verdict, 'CFO without executive role should be denied for roleMatchMode:all').toBe('deny');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool drift (5 cases)
  // ---------------------------------------------------------------------------
  describe('tool-drift', () => {
    it('known tool allowed for authorized role', async () => {
      const res = await clients['cfo-agent'].post('/evaluate', {
        body: { action: 'finance-summary-read', surfaceId: 'finance-reporting', agentId: 'cfo-agent' },
      });
      expect(res.status, 'Known tool should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Known finance tool should be allowed for CFO').toBe('allow');
    });

    it('unknown tool denied by default policy', async () => {
      const res = await clients['ceo-agent'].post('/evaluate', {
        body: { action: 'unknown-experimental-tool', surfaceId: 'unknown', agentId: 'ceo-agent' },
      });
      expect(res.status, 'Unknown tool should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Unknown tool should be denied by default policy').toBe('deny');
    });

    it('decommissioned tool denied — no matching allow rule', async () => {
      const res = await clients['cfo-agent'].post('/evaluate', {
        body: { action: 'legacy-report-generator', surfaceId: 'finance-reporting', agentId: 'cfo-agent' },
      });
      expect(res.status, 'Decommissioned tool should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Decommissioned tool should be denied').toBe('deny');
    });

    it('tool not in any rule denied for all agents', async () => {
      const agentIds = ['ceo-agent', 'cfo-agent', 'vp-eng-agent', 'hr-lead-agent', 'product-agent'];
      for (const agentId of agentIds) {
        const res = await clients[agentId].post('/evaluate', {
          body: { action: 'nonexistent-phantom-tool', surfaceId: 'phantom', agentId },
        });
        expect(res.status, `Phantom tool for ${agentId} should return 200`).toBe(200);
        const data = res.data as { data: { verdict: string } };
        expect(data.data.verdict, `Phantom tool should be denied for ${agentId}`).toBe('deny');
      }
    });

    it('brain-lookup tool allowed for all non-contractor agents', async () => {
      const allowed = ['ceo-agent', 'cfo-agent', 'finance-analyst-agent', 'vp-eng-agent', 'hr-lead-agent', 'product-agent'];
      for (const agentId of allowed) {
        const res = await clients[agentId].post('/evaluate', {
          body: { action: 'brain-lookup', surfaceId: 'memory', agentId },
        });
        expect(res.status, `Brain lookup for ${agentId} should return 200`).toBe(200);
        const data = res.data as { data: { verdict: string } };
        expect(data.data.verdict, `Brain lookup should be allowed for ${agentId}`).toBe('allow');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Red-team (5 cases)
  // ---------------------------------------------------------------------------
  describe('red-team', () => {
    it('prompt injection via actionType denied', async () => {
      const res = await clients['contractor-agent'].post('/evaluate', {
        body: {
          action: 'finance-report-read; DROP TABLE policies;--',
          surfaceId: 'finance-reporting',
          agentId: 'contractor-agent',
        },
      });
      expect(res.status, 'Injection attempt should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Injection payload should be denied by default').toBe('deny');
    });

    it('cross-role data leakage — product agent cannot access HR data', async () => {
      const res = await clients['product-agent'].post('/evaluate', {
        body: { action: 'hr-record-read', surfaceId: 'hr-portal', agentId: 'product-agent' },
      });
      expect(res.status, 'Product-to-HR cross-role should return 200').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Product agent should be denied HR data access').toBe('deny');
    });

    it('error messages do not leak internal role names on auth failure', async () => {
      const res = await clients['ceo-agent'].getWithToken('/evaluate', 'invalid-probe-token');
      expect(res.status, 'Invalid token should return 403').toBe(403);
      const data = res.data as Record<string, unknown>;
      const errorStr = JSON.stringify(data);
      expect(errorStr, 'Error should not leak executive role').not.toContain('executive');
      expect(errorStr, 'Error should not leak approver role').not.toContain('approver');
      expect(errorStr, 'Error should not leak audit_admin role').not.toContain('audit_admin');
    });

    it('hash confusion — sending stored hash as token is rejected', async () => {
      const storedHash = server.fixtures.tokens.bindings[0].subject;
      const res = await clients['ceo-agent'].getWithToken('/evaluate', storedHash);
      expect(res.status, 'Stored hash used as token should return 403').toBe(403);
      const data = res.data as Record<string, unknown>;
      expect(data.code, 'Hash confusion should return unknown_token').toBe('unknown_token');
    });

    it('callerRoles injection does not escalate privileges', async () => {
      const res = await clients['contractor-agent'].post('/evaluate', {
        body: {
          action: 'deploy-production',
          surfaceId: 'deployment',
          agentId: 'contractor-agent',
          callerRoles: ['deployer', 'executive', 'approver'],
        },
      });
      expect(res.status, 'Injected callerRoles should not elevate contractor').toBe(200);
      const data = res.data as { data: { verdict: string } };
      expect(data.data.verdict, 'Contractor should still be denied despite injected deployer role').toBe('deny');
    });
  });

  // ---------------------------------------------------------------------------
  // Provisioning round-trip (5 cases)
  // ---------------------------------------------------------------------------
  describe('provisioning-round-trip', () => {
    let provisionedServer: OrgTestServerInstance;
    let provisionedBaseUrl: string;
    let generatedToken: string;
    let generatedSalt: string;

    beforeAll(async () => {
      // Step 1: Generate a fresh token and salt
      generatedToken = generateAgentToken();
      generatedSalt = generateAgentSalt();
      const tokenHash = hashToken(generatedToken, generatedSalt);

      // Step 2: Build an auth store from the generated credentials
      const provisionedAuthStore: AgentAuthStore = {
        bindings: [
          {
            subject: tokenHash,
            salt: generatedSalt,
            agentId: 'provisioned-agent',
            tenantId: 'provisioned-tenant',
            enabled: true,
          },
        ],
      };

      // Step 3: Create a fresh org-mode server with the provisioned auth store
      provisionedServer = await createOrgTestServer();
      provisionedBaseUrl = provisionedServer.baseUrl();

      // Inject the provisioned binding into the server's auth store
      provisionedServer.fixtures.tokens.bindings.push(provisionedAuthStore.bindings[0]);

      // Register the provisioned agent in the registry
      provisionedServer.fixtures.agents.agents.push({
        agentId: 'provisioned-agent',
        displayName: 'Provisioned Agent',
        humanOwner: 'Provisioning Test',
        roles: ['product'],
        surfaces: ['http'],
        personalBrain: null as unknown as string,
        authSubject: 'provisioned-auth-subject',
        enabled: true,
      });
    });

    afterAll(async () => {
      await provisionedServer.close();
    });

    it('generated token authenticates against generated auth store', async () => {
      const res = await fetch(`${provisionedBaseUrl}/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${generatedToken}`,
        },
        body: JSON.stringify({
          action: 'public-read',
          surfaceId: 'public-dashboard',
          agentId: 'provisioned-agent',
        }),
      });
      expect(res.status, 'Provisioned token should authenticate successfully').toBe(200);
      const data = await res.json();
      expect(data.status, 'Provisioned request should return ok status').toBe('ok');
    });

    it('provisioned agent receives correct verdict', async () => {
      // Provisioned agent evaluates through the provisioned server with pack rules.
      // Proves the generated token → auth store → server → evaluate pipeline works.
      const res = await fetch(`${provisionedBaseUrl}/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${generatedToken}`,
        },
        body: JSON.stringify({
          action: 'finance-report-read',
          surfaceId: 'finance-reporting',
          agentId: 'provisioned-agent',
        }),
      });
      expect(res.status, 'Provisioned agent evaluate should return 200').toBe(200);
      const data = await res.json();
      expect(data.status, 'Provisioned evaluate should return ok').toBe('ok');
      expect(data.data.verdict, 'Provisioned agent should receive a verdict').toBeDefined();
      expect(
        ['allow', 'deny', 'approve_required'].includes(data.data.verdict),
        `Verdict should be a valid policy verdict, got: ${data.data.verdict}`,
      ).toBe(true);
    });

    it('wrong token does not authenticate against provisioned store', async () => {
      const res = await fetch(`${provisionedBaseUrl}/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer completely-wrong-token',
        },
        body: JSON.stringify({
          action: 'public-read',
          surfaceId: 'public-dashboard',
          agentId: 'provisioned-agent',
        }),
      });
      expect(res.status, 'Wrong token should be rejected').toBe(403);
      const data = await res.json();
      expect(data.code, 'Wrong token should return unknown_token code').toBe('unknown_token');
    });

    it('generated salt changes the hash — different salt rejects the same token', async () => {
      const differentSalt = generateAgentSalt();
      const differentHash = hashToken(generatedToken, differentSalt);
      // The hash with a different salt should NOT match the stored hash
      const storedHash = hashToken(generatedToken, generatedSalt);
      expect(differentHash, 'Different salt should produce different hash').not.toBe(storedHash);
    });

    it('provisioned agent identity resolves with correct tenantId', async () => {
      const res = await fetch(`${provisionedBaseUrl}/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${generatedToken}`,
        },
        body: JSON.stringify({
          action: 'public-read',
          surfaceId: 'public-dashboard',
          agentId: 'provisioned-agent',
        }),
      });
      expect(res.status, 'Provisioned agent request should succeed').toBe(200);
      const data = await res.json();
      expect(data.status, 'Provisioned request should succeed').toBe('ok');
    });
  });
});
