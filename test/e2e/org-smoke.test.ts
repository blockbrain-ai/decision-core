/**
 * Org-Mode Smoke Test
 *
 * Proves the Meridian Systems test infrastructure works end-to-end
 * by running one allow and one deny through the full HTTP stack.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createOrgTestServer, type OrgTestServerInstance } from '../helpers/org-test-server.js';
import { createAgentHttpClient } from '../helpers/agent-http-client.js';
import { loadMeridianFixtures } from '../helpers/org-fixture-loader.js';
import { createMockGBrainTransport } from '../helpers/mock-gbrain-transport.js';
import { assertStepResult, type ScenarioStep } from '../helpers/scenario-runner.js';

describe('Meridian Systems org-mode smoke test', () => {
  let server: OrgTestServerInstance;

  beforeAll(async () => {
    server = await createOrgTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('fixture validation', () => {
    it('loads and validates all fixtures without errors', () => {
      const fixtures = loadMeridianFixtures();
      expect(fixtures.agents.tenantId).toBe('meridian-systems');
      expect(fixtures.agents.agents).toHaveLength(7);
      expect(fixtures.tokens.bindings).toHaveLength(7);
      expect(fixtures.policyPack.name).toBe('meridian-systems-enterprise');
      expect(fixtures.policyPack.profile).toBe('enterprise');
      expect(fixtures.accessPolicy.classifications).toHaveLength(6);
      expect(fixtures.toolInventory.tools.length).toBeGreaterThanOrEqual(14);
      expect(fixtures.brains.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe('HTTP allow path', () => {
    it('CEO agent can evaluate an action through the HTTP stack', async () => {
      const ceo = createAgentHttpClient(server.baseUrl(), 'ceo-agent');

      const response = await ceo.post('/evaluate', {
        body: {
          surfaceId: 'http',
          action: 'public-report-read',
          context: {},
        },
      });

      expect(response.status).toBe(200);
      const data = response.data as { status: string; data: { verdict: string } };
      expect(data.status).toBe('ok');
      expect(data.data.verdict).toBeDefined();
    });
  });

  describe('HTTP deny path', () => {
    it('rejects request with invalid token', async () => {
      const ceo = createAgentHttpClient(server.baseUrl(), 'ceo-agent');

      const response = await ceo.getWithToken('/evaluate', 'completely-invalid-token');
      expect(response.status).toBe(403);
      const data = response.data as { code: string };
      expect(data.code).toBe('unknown_token');
    });

    it('rejects unauthenticated request', async () => {
      const ceo = createAgentHttpClient(server.baseUrl(), 'ceo-agent');

      const response = await ceo.getUnauthenticated('/evaluate');
      expect(response.status).toBe(401);
      const data = response.data as { code: string };
      expect(data.code).toBe('AUTH_REQUIRED');
    });
  });

  describe('agent identity spoofing prevention', () => {
    it('rejects body agentId that does not match token identity', async () => {
      const contractor = createAgentHttpClient(server.baseUrl(), 'contractor-agent');

      const response = await contractor.post('/evaluate', {
        body: {
          surfaceId: 'http',
          action: 'finance-transfer',
          agentId: 'ceo-agent',
        },
      });

      expect(response.status).toBe(403);
      const data = response.data as { code: string };
      expect(data.code).toBe('agent_mismatch');
    });
  });

  describe('scenario runner assertions', () => {
    it('assertStepResult works for a passing step', async () => {
      const ceo = createAgentHttpClient(server.baseUrl(), 'ceo-agent');

      const response = await ceo.post('/evaluate', {
        body: {
          surfaceId: 'http',
          action: 'test-action',
          context: {},
        },
      });

      const step: ScenarioStep = {
        name: 'test-step',
        agentId: 'ceo-agent',
        method: 'POST',
        path: '/evaluate',
        expect: { status: 200 },
      };

      assertStepResult(response, step);
    });
  });

  describe('mock G-brain transport', () => {
    it('returns data for mounted brains and null for unmounted', () => {
      const fixtures = loadMeridianFixtures();
      const transport = createMockGBrainTransport(fixtures.brains);

      const ceoResult = transport.query({ brainId: 'ceo-brain' });
      expect(ceoResult.mounted).toBe(true);
      expect(ceoResult.data).not.toBeNull();

      const unmountedResult = transport.query({ brainId: 'unmounted-brain' });
      expect(unmountedResult.mounted).toBe(false);
      expect(unmountedResult.data).toBeNull();
    });

    it('supports mount and unmount operations', () => {
      const fixtures = loadMeridianFixtures();
      const transport = createMockGBrainTransport(fixtures.brains);

      expect(transport.isMounted('ceo-brain')).toBe(true);
      transport.unmount('ceo-brain');
      expect(transport.isMounted('ceo-brain')).toBe(false);
      expect(transport.query({ brainId: 'ceo-brain' }).data).toBeNull();

      transport.mount('ceo-brain');
      expect(transport.isMounted('ceo-brain')).toBe(true);
      expect(transport.query({ brainId: 'ceo-brain' }).data).not.toBeNull();
    });

    it('supports key-scoped queries on mounted brains', () => {
      const fixtures = loadMeridianFixtures();
      const transport = createMockGBrainTransport(fixtures.brains);

      const result = transport.query({ brainId: 'ceo-brain', key: 'strategic-priorities' });
      expect(result.mounted).toBe(true);
      expect(result.data).toHaveProperty('strategic-priorities');

      const missingKey = transport.query({ brainId: 'ceo-brain', key: 'nonexistent-key' });
      expect(missingKey.mounted).toBe(true);
      expect(missingKey.data).toBeNull();
    });

    it('returns correct mounted brain IDs', () => {
      const fixtures = loadMeridianFixtures();
      const transport = createMockGBrainTransport(fixtures.brains);

      const mountedIds = transport.getMountedBrainIds();
      expect(mountedIds).toContain('ceo-brain');
      expect(mountedIds).toContain('cfo-brain');
      expect(mountedIds).not.toContain('unmounted-brain');

      const allIds = transport.getAllBrainIds();
      expect(allIds).toContain('unmounted-brain');
      expect(allIds.length).toBeGreaterThan(mountedIds.length);
    });
  });
});
