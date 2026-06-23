/**
 * Mutation Verification Tests — Prove tests catch security regressions.
 *
 * Each test swaps one broken implementation into the system, runs targeted
 * assertions against it, and verifies the assertions produce expected failures.
 * This closes the gap between "tests exist" and "tests actually protect us."
 *
 * Failures are caught internally — this file does not pollute ordinary test output.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// -- Broken implementations --
import { createBrokenAuthResolver } from './broken-auth.js';
import { createBrokenRoleResolver } from './broken-role-resolution.js';
import { brokenCanAccess, brokenGetAuthorisedBrains, brokenVerifyMounts } from './broken-access-policy.js';
import { brokenCheckSeparationOfDuties } from './broken-approval-routing.js';
import { brokenWrapPdpDenyUnknown } from './broken-deny-unknown.js';
import { brokenContainsPII, brokenRedactPII, brokenDeepRedactItem, brokenDeepRedactExport } from './broken-redaction.js';

// -- Real implementations --
import { canAccess, getAuthorisedBrains, verifyMounts } from '../../src/identity/access-policy-loader.js';
import { checkSeparationOfDuties } from '../../src/approval/approval-routing.js';
import { wrapPdpDenyUnknown } from '../../src/policy/deny-unknown-wrapper.js';
import { containsPII, redactPII, deepRedactItem, deepRedactExport } from '../../src/onboarding/memory-evidence/memory-evidence-redaction.js';

// -- Test infrastructure --
import { createHttpServer } from '../../src/surfaces/http/http-server.js';
import type { HttpServerDeps } from '../../src/surfaces/http/types.js';
import { InMemoryPolicyRuleRepository } from '../../src/persistence/memory/in-memory-policy-rule.repository.js';
import { InMemoryDecisionLogRepository } from '../../src/persistence/memory/in-memory-decision-log.repository.js';
import { PolicyDecisionPoint } from '../../src/policy/policy-decision-point.js';
import { NoOpEventService } from '../../src/adapters/event-service.js';
import { loadMeridianFixtures, type MeridianFixtures } from '../helpers/org-fixture-loader.js';
import { createAgentHttpClient } from '../helpers/agent-http-client.js';
import { RBAC_RULES } from '../helpers/rbac-test-server.js';
import { hashToken } from '../../src/identity/agent-auth.js';
import { resolveAgentRoles, findAgentById } from '../../src/identity/agent-registry.js';
import type { TenantId } from '../../src/contracts/common.contracts.js';
import type { MemoryEvidenceItem, MemoryEvidenceExport } from '../../src/onboarding/memory-evidence/memory-evidence.contracts.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let fixtures: MeridianFixtures;
const tenantId = 'meridian-systems' as TenantId;

beforeAll(() => {
  fixtures = loadMeridianFixtures();
});

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

/**
 * Helper: create a server with custom identity resolver and optional
 * deny-unknown wrapper. Returns the server and a function to evaluate.
 */
async function createMutationServer(opts: {
  identityResolver: import('../../src/surfaces/http/types.js').OrgIdentityResolver;
  wrapEvaluator?: (evaluator: HttpServerDeps['policyEvaluator']) => HttpServerDeps['policyEvaluator'];
}) {
  const policyRuleRepo = new InMemoryPolicyRuleRepository();
  const decisionLogRepo = new InMemoryDecisionLogRepository();
  const eventService = new NoOpEventService();
  const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);

  // Seed RBAC rules
  for (const rule of RBAC_RULES) {
    await policyRuleRepo.create(tenantId, rule);
  }

  let evaluator: HttpServerDeps['policyEvaluator'] = {
    async evaluate(tid: string, _surfaceId: string, action: string, context?: Record<string, unknown>) {
      return pdp.evaluate(tid as TenantId, {
        enforcementPoint: 'pre_decision',
        actionType: action,
        agentId: context?.agentId as string | undefined,
        callerRoles: context?.callerRoles as string[] | undefined,
      });
    },
  };

  // Apply deny-unknown wrapper to evaluator
  const originalEvaluate = evaluator.evaluate.bind(evaluator);
  evaluator.evaluate = async (tid, surfaceId, action, context) => {
    const result = await originalEvaluate(tid, surfaceId, action, context);
    if (result.verdict === 'allow' && result.matchedPolicies.length === 0) {
      return {
        verdict: 'deny' as const,
        matchedPolicies: [{
          ruleId: 'deny-unknown',
          ruleName: 'deny-unknown-default',
          verdict: 'deny' as const,
          reason: 'No policy rules matched — denied by default',
        }],
      };
    }
    return result;
  };

  if (opts.wrapEvaluator) {
    evaluator = opts.wrapEvaluator(evaluator);
  }

  const deps: HttpServerDeps = {
    tenantId,
    policyEvaluator: evaluator,
    policyRuleRepo,
    decisionLogRepo,
  };

  const server = await createHttpServer(deps, {
    host: '127.0.0.1',
    port: 0,
    orgMode: true,
    identityResolver: opts.identityResolver,
  });

  const addr = server.address()!;
  const baseUrl = `http://${addr.host}:${addr.port}`;

  return { server, baseUrl, close: () => server.close() };
}

/**
 * Helper: expects a synchronous assertion to fail.
 * Returns true if the assertion threw (mutation caught), false if it passed.
 */
function expectFailure(fn: () => void): boolean {
  try {
    fn();
    return false; // assertion passed — mutation was NOT caught
  } catch {
    return true; // assertion failed — mutation WAS caught
  }
}

/**
 * Async variant for assertions in async test contexts.
 */
async function expectFailureAsync(fn: () => void | Promise<void>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

// ===========================================================================
// Mutation 1: Broken Auth — accepts any bearer token
// ===========================================================================

describe('mutation-verification', () => {
  describe('mutation: broken-auth (accepts any bearer token)', () => {
    let baseUrl: string;
    let close: () => Promise<void>;

    beforeAll(async () => {
      const brokenResolver = createBrokenAuthResolver(fixtures.agents, fixtures.tokens);
      const result = await createMutationServer({ identityResolver: brokenResolver });
      baseUrl = result.baseUrl;
      close = result.close;
    });

    afterAll(async () => {
      await close();
    });

    it('spoofing with a forged token is detected as regression', async () => {
      // With broken auth, a completely forged token should still get authenticated.
      // The real system rejects forged tokens; broken auth accepts them.
      const client = createAgentHttpClient(baseUrl, 'contractor-agent');
      const forgedToken = 'completely-forged-token-not-in-auth-store';

      const response = await client.postWithToken('/evaluate', forgedToken, {
        body: { surfaceId: 'test', action: 'public-status-read' },
      });

      // Broken auth accepts the forged token — the request succeeds instead of being rejected.
      // This is the regression: forged tokens should be rejected (403/401), not accepted (200).
      const caught = await expectFailureAsync(() => {
        expect(response.status).toBe(403);
      });
      expect(caught).toBe(true);
    });

    it('body agentId spoofing is detected as regression', async () => {
      // With broken auth, supplying a different agentId in the body allows identity spoofing.
      // Use approve-request which CEO can do (executive+approver) but contractor cannot.
      const contractorToken = 'mrd-test-token-contractor-agent';
      const response = await fetch(`${baseUrl}/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${contractorToken}`,
        },
        body: JSON.stringify({
          surfaceId: 'approval-queue',
          action: 'approve-request',
          agentId: 'ceo-agent',
        }),
      });
      const body = await response.json() as EvalResponse;

      // Broken auth trusts body agentId and resolves CEO roles (executive+approver).
      // Real auth would reject the mismatch or resolve contractor identity → denied.
      // With broken auth, approve-request resolves with CEO roles → allowed.
      const caught = await expectFailureAsync(() => {
        // The real system would deny contractor approval access
        expect(body.data.verdict).toBe('deny');
      });
      expect(caught).toBe(true);
    });
  });

  // ===========================================================================
  // Mutation 2: Broken Role Resolution — trusts request-body callerRoles
  // ===========================================================================

  describe('mutation: broken-role-resolution (trusts body callerRoles)', () => {
    let baseUrl: string;
    let close: () => Promise<void>;
    let brokenResolver: ReturnType<typeof createBrokenRoleResolver>;

    beforeAll(async () => {
      brokenResolver = createBrokenRoleResolver(fixtures.agents, fixtures.tokens);
      const result = await createMutationServer({ identityResolver: brokenResolver });
      baseUrl = result.baseUrl;
      close = result.close;
    });

    afterAll(async () => {
      await close();
    });

    it('product agent escalating to finance role is detected as regression', async () => {
      // Inject finance roles into the broken resolver
      brokenResolver.injectRoles(['finance', 'finance_analyst']);

      const client = createAgentHttpClient(baseUrl, 'product-agent');
      const response = await client.post('/evaluate', {
        body: { surfaceId: 'finance-reporting', action: 'finance-report-read' },
      });
      const body = response.data as EvalResponse;

      // With broken role resolution, product agent gets finance roles → allowed.
      // Real system resolves product roles → denied.
      const caught = await expectFailureAsync(() => {
        expect(body.data.verdict).toBe('deny');
      });
      expect(caught).toBe(true);

      // Reset
      brokenResolver.injectRoles([]);
    });

    it('contractor escalating to executive+approver is detected as regression', async () => {
      brokenResolver.injectRoles(['executive', 'approver']);

      const client = createAgentHttpClient(baseUrl, 'contractor-agent');
      const response = await client.post('/evaluate', {
        body: { surfaceId: 'approval-queue', action: 'approve-request' },
      });
      const body = response.data as EvalResponse;

      // With broken role resolution, contractor gets executive+approver → allowed.
      // Real system resolves contractor roles → denied.
      const caught = await expectFailureAsync(() => {
        expect(body.data.verdict).toBe('deny');
      });
      expect(caught).toBe(true);

      brokenResolver.injectRoles([]);
    });
  });

  // ===========================================================================
  // Mutation 3: Broken Access Policy — grants all roles all access
  // ===========================================================================

  describe('mutation: broken-access-policy (grants all roles all access)', () => {
    it('contractor accessing finance classification is detected as regression', () => {
      const policy = fixtures.accessPolicy;

      // Real implementation denies contractor access to confidential-finance
      expect(canAccess(policy, 'contractor', 'confidential-finance')).toBe(false);

      // Broken implementation allows it
      const caught = expectFailure(() => {
        expect(brokenCanAccess(policy, 'contractor', 'confidential-finance')).toBe(false);
      });
      expect(caught).toBe(true);
    });

    it('contractor accessing hr-restricted is detected as regression', () => {
      const policy = fixtures.accessPolicy;

      expect(canAccess(policy, 'contractor', 'hr-restricted')).toBe(false);

      const caught = expectFailure(() => {
        expect(brokenCanAccess(policy, 'contractor', 'hr-restricted')).toBe(false);
      });
      expect(caught).toBe(true);
    });

    it('contractor getting all brains is detected as regression', () => {
      const policy = fixtures.accessPolicy;

      const realBrains = getAuthorisedBrains(policy, 'contractor');
      expect(realBrains).toHaveLength(1);
      expect(realBrains).toContain('public-brain');

      const brokenBrains = brokenGetAuthorisedBrains(policy, 'contractor');

      const caught = expectFailure(() => {
        expect(brokenBrains).toHaveLength(1);
      });
      expect(caught).toBe(true);
    });

    it('mount verification finding no violations is detected as regression', () => {
      const policy = fixtures.accessPolicy;
      const classificationBrains = policy.classifications.map((c) => c.brain);

      const realViolations = verifyMounts(policy, [{
        agentId: 'contractor-agent',
        roles: ['contractor'],
        mountedBrains: classificationBrains,
      }]);
      expect(realViolations.length).toBeGreaterThan(0);

      const brokenViolations = brokenVerifyMounts(policy, [{
        agentId: 'contractor-agent',
        roles: ['contractor'],
        mountedBrains: classificationBrains,
      }]);

      const caught = expectFailure(() => {
        expect(brokenViolations.length).toBeGreaterThan(0);
      });
      expect(caught).toBe(true);
    });
  });

  // ===========================================================================
  // Mutation 4: Broken Approval Routing — allows self-approval
  // ===========================================================================

  describe('mutation: broken-approval-routing (allows self-approval)', () => {
    it('self-approval without break-glass is detected as regression', () => {
      // Real implementation blocks self-approval
      const realResult = checkSeparationOfDuties(
        'cfo-agent', 'cfo-agent', ['finance', 'approver'],
      );
      expect(realResult.allowed).toBe(false);

      // Broken implementation allows it
      const brokenResult = brokenCheckSeparationOfDuties(
        'cfo-agent', 'cfo-agent', ['finance', 'approver'],
      );

      const caught = expectFailure(() => {
        expect(brokenResult.allowed).toBe(false);
      });
      expect(caught).toBe(true);
    });

    it('CEO self-approval without break-glass is detected as regression', () => {
      const realResult = checkSeparationOfDuties(
        'ceo-agent', 'ceo-agent', ['executive', 'approver', 'ceo'],
      );
      expect(realResult.allowed).toBe(false);

      const brokenResult = brokenCheckSeparationOfDuties(
        'ceo-agent', 'ceo-agent', ['executive', 'approver', 'ceo'],
      );

      const caught = expectFailure(() => {
        expect(brokenResult.allowed).toBe(false);
      });
      expect(caught).toBe(true);
    });

    it('break-glass without reason is detected as regression', () => {
      const futureExpiry = new Date(Date.now() + 3600000).toISOString();

      const realResult = checkSeparationOfDuties(
        'ceo-agent', 'ceo-agent', ['executive', 'approver', 'ceo'],
        { reason: '', expiresAt: futureExpiry },
      );
      expect(realResult.allowed).toBe(false);

      const brokenResult = brokenCheckSeparationOfDuties(
        'ceo-agent', 'ceo-agent', ['executive', 'approver', 'ceo'],
        { reason: '', expiresAt: futureExpiry },
      );

      const caught = expectFailure(() => {
        expect(brokenResult.allowed).toBe(false);
      });
      expect(caught).toBe(true);
    });

    it('break-glass with expired timestamp is detected as regression', () => {
      const pastExpiry = new Date(Date.now() - 3600000).toISOString();

      const realResult = checkSeparationOfDuties(
        'ceo-agent', 'ceo-agent', ['executive', 'approver', 'ceo'],
        { reason: 'Emergency', expiresAt: pastExpiry },
      );
      expect(realResult.allowed).toBe(false);

      const brokenResult = brokenCheckSeparationOfDuties(
        'ceo-agent', 'ceo-agent', ['executive', 'approver', 'ceo'],
        { reason: 'Emergency', expiresAt: pastExpiry },
      );

      const caught = expectFailure(() => {
        expect(brokenResult.allowed).toBe(false);
      });
      expect(caught).toBe(true);
    });

    it('non-CEO break-glass is detected as regression', () => {
      const futureExpiry = new Date(Date.now() + 3600000).toISOString();

      const realResult = checkSeparationOfDuties(
        'cfo-agent', 'cfo-agent', ['finance', 'approver'],
        { reason: 'Urgent payment', expiresAt: futureExpiry },
      );
      expect(realResult.allowed).toBe(false);

      const brokenResult = brokenCheckSeparationOfDuties(
        'cfo-agent', 'cfo-agent', ['finance', 'approver'],
        { reason: 'Urgent payment', expiresAt: futureExpiry },
      );

      const caught = expectFailure(() => {
        expect(brokenResult.allowed).toBe(false);
      });
      expect(caught).toBe(true);
    });
  });

  // ===========================================================================
  // Mutation 5: Broken Deny Unknown — allows unknown tools
  // ===========================================================================

  describe('mutation: broken-deny-unknown (allows unknown tools)', () => {
    it('unknown action being allowed is detected as regression', async () => {
      const policyRuleRepo = new InMemoryPolicyRuleRepository();
      const eventService = new NoOpEventService();
      const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);

      // Seed RBAC rules
      for (const rule of RBAC_RULES) {
        await policyRuleRepo.create(tenantId, rule);
      }

      // Real wrapper: unknown actions are denied
      const realWrapped = wrapPdpDenyUnknown(pdp);
      const realResult = await realWrapped.evaluate(tenantId, {
        enforcementPoint: 'pre_decision',
        actionType: 'completely-unknown-action-xyz',
        callerRoles: ['finance'],
      });
      expect(realResult.verdict).toBe('deny');
      expect(realResult.matchedPolicies.some((p) => p.ruleName === 'deny-unknown-default')).toBe(true);

      // Broken wrapper: unknown actions pass through
      const brokenWrapped = brokenWrapPdpDenyUnknown(pdp);
      const brokenResult = await brokenWrapped.evaluate(tenantId, {
        enforcementPoint: 'pre_decision',
        actionType: 'completely-unknown-action-xyz',
        callerRoles: ['finance'],
      });

      const caught = await expectFailureAsync(() => {
        expect(brokenResult.verdict).toBe('deny');
      });
      expect(caught).toBe(true);
    });

    it('unknown action via HTTP is detected as regression', async () => {
      // Create a server where the deny-unknown wrapper is disabled
      const realResolver = createRealResolver(fixtures);

      const policyRuleRepo = new InMemoryPolicyRuleRepository();
      const decisionLogRepo = new InMemoryDecisionLogRepository();
      const eventService = new NoOpEventService();
      const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);

      for (const rule of RBAC_RULES) {
        await policyRuleRepo.create(tenantId, rule);
      }

      // Create evaluator WITHOUT deny-unknown wrapper
      const evaluator: HttpServerDeps['policyEvaluator'] = {
        async evaluate(tid: string, _surfaceId: string, action: string, context?: Record<string, unknown>) {
          return pdp.evaluate(tid as TenantId, {
            enforcementPoint: 'pre_decision',
            actionType: action,
            agentId: context?.agentId as string | undefined,
            callerRoles: context?.callerRoles as string[] | undefined,
          });
        },
      };

      const deps: HttpServerDeps = {
        tenantId,
        policyEvaluator: evaluator,
        policyRuleRepo,
        decisionLogRepo,
      };

      const server = await createHttpServer(deps, {
        host: '127.0.0.1',
        port: 0,
        orgMode: true,
        identityResolver: realResolver,
      });

      const addr = server.address()!;
      const brokenBaseUrl = `http://${addr.host}:${addr.port}`;

      try {
        const client = createAgentHttpClient(brokenBaseUrl, 'cfo-agent');
        const response = await client.post('/evaluate', {
          body: { surfaceId: 'test', action: 'completely-unknown-action-xyz' },
        });
        const body = response.data as EvalResponse;

        // Without deny-unknown, the PDP returns allow for unmatched actions.
        const caught = await expectFailureAsync(() => {
          expect(body.data.verdict).toBe('deny');
        });
        expect(caught).toBe(true);
      } finally {
        await server.close();
      }
    });
  });

  // ===========================================================================
  // Mutation 6: Broken Redaction — leaks restricted payload
  // ===========================================================================

  describe('mutation: broken-redaction (leaks restricted payload)', () => {
    const SECRET_TEXT = 'API key: sk-1234567890abcdefghijklmnop';
    const PII_TEXT = 'Contact: john.doe@example.com, SSN: 123-45-6789';
    const CLEAN_TEXT = 'This is a clean summary with no secrets or PII.';

    it('PII detection failure is detected as regression', () => {
      // Real implementation detects PII
      expect(containsPII(PII_TEXT)).toBe(true);

      // Broken implementation misses PII
      const caught = expectFailure(() => {
        expect(brokenContainsPII(PII_TEXT)).toBe(true);
      });
      expect(caught).toBe(true);
    });

    it('PII not being redacted is detected as regression', () => {
      // Real implementation redacts PII
      const realRedacted = redactPII(PII_TEXT);
      expect(realRedacted).toContain('[EMAIL_REDACTED]');
      expect(realRedacted).toContain('[SSN_REDACTED]');

      // Broken implementation returns raw text
      const brokenRedacted = brokenRedactPII(PII_TEXT);

      const caught = expectFailure(() => {
        expect(brokenRedacted).toContain('[EMAIL_REDACTED]');
      });
      expect(caught).toBe(true);
    });

    it('deep redaction failure for secrets is detected as regression', () => {
      const secretItem: MemoryEvidenceItem = {
        id: 'test-secret',
        summary: SECRET_TEXT,
        sourceRef: 'test-ref',
        confidence: 0.9,
        sensitive: false,
      };

      // Real implementation redacts secrets
      const realResult = deepRedactItem(secretItem);
      expect(realResult.hadSecret).toBe(true);
      expect(realResult.item.summary).toContain('[REDACTED');

      // Broken implementation passes through
      const brokenResult = brokenDeepRedactItem(secretItem);

      const caught = expectFailure(() => {
        expect(brokenResult.hadSecret).toBe(true);
      });
      expect(caught).toBe(true);
    });

    it('deep redaction failure for PII is detected as regression', () => {
      const piiItem: MemoryEvidenceItem = {
        id: 'test-pii',
        summary: PII_TEXT,
        sourceRef: 'test-ref',
        confidence: 0.9,
        sensitive: false,
      };

      // Real implementation redacts PII
      const realResult = deepRedactItem(piiItem);
      expect(realResult.hadPII).toBe(true);
      expect(realResult.item.sensitive).toBe(true);

      // Broken implementation passes through
      const brokenResult = brokenDeepRedactItem(piiItem);

      const caught = expectFailure(() => {
        expect(brokenResult.hadPII).toBe(true);
      });
      expect(caught).toBe(true);
    });

    it('export redaction failure is detected as regression', () => {
      const exportData: MemoryEvidenceExport = {
        schemaVersion: 1,
        sourceId: 'test-source',
        sourceKind: 'mempalace',
        collectedBy: 'decision-core',
        collectedAt: new Date().toISOString(),
        consent: { readGranted: true, writeBackGranted: false, scope: ['test'] },
        items: [
          {
            id: 'item-1',
            summary: SECRET_TEXT,
            sourceRef: 'ref-1',
            confidence: 0.9,
            sensitive: false,
          },
          {
            id: 'item-2',
            summary: PII_TEXT,
            sourceRef: 'ref-2',
            confidence: 0.8,
            sensitive: false,
          },
          {
            id: 'item-3',
            summary: CLEAN_TEXT,
            sourceRef: 'ref-3',
            confidence: 0.95,
            sensitive: false,
          },
        ],
      };

      // Real implementation redacts
      const realResult = deepRedactExport(exportData);
      expect(realResult.stats.secretsRedacted).toBeGreaterThan(0);
      expect(realResult.stats.piiRedacted).toBeGreaterThan(0);

      // Broken implementation passes through
      const brokenResult = brokenDeepRedactExport(exportData);

      const caught = expectFailure(() => {
        expect(brokenResult.stats.secretsRedacted).toBeGreaterThan(0);
      });
      expect(caught).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Utility: create a correct identity resolver (for tests that only mutate
// other components and need correct auth)
// ---------------------------------------------------------------------------

function createRealResolver(fix: MeridianFixtures): import('../../src/surfaces/http/types.js').OrgIdentityResolver {
  return {
    resolve(token: string, bodyAgentId?: string) {
      const binding = fix.tokens.bindings.find(
        (b) => b.subject === hashToken(token, b.salt),
      );

      if (!binding) {
        return { error: 'Bearer token not recognized', code: 'unknown_token' };
      }

      if (!binding.enabled) {
        return { error: `Auth binding for ${binding.agentId} is disabled`, code: 'disabled_binding' };
      }

      if (bodyAgentId && bodyAgentId !== binding.agentId) {
        return {
          error: `Body agentId "${bodyAgentId}" does not match authenticated identity "${binding.agentId}"`,
          code: 'agent_mismatch',
        };
      }

      const agent = findAgentById(fix.agents, binding.agentId);
      if (!agent || !agent.enabled) {
        return { error: `Agent ${binding.agentId} is disabled`, code: 'agent_disabled' };
      }

      const roles = resolveAgentRoles(fix.agents, binding.agentId);
      return {
        agentId: binding.agentId,
        tenantId: binding.tenantId,
        roles,
      };
    },
  };
}
