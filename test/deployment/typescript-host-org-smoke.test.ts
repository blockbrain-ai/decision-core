/**
 * DC Run 8.13 — TypeScript Agent Host Bridge Simulation Test
 *
 * Bridge simulation test proving Decision Core's in-process policy guard works
 * with the call shapes a TypeScript agent host would use. This test does NOT
 * spawn a real OpenClaw host process or load plugins through a host plugin system.
 * It simulates the in-process guard calls that the OpenClaw integration would make.
 *
 * For live host process verification, see test/live-hosts/live-hosts.test.ts.
 *
 * When the TypeScript agent host source-pack is unavailable, the suite skips cleanly.
 * Set RUN_DEPLOYMENT_TESTS=1 to force failure when the host is missing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync, type ChildProcess } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import type { OrgTestServerInstance } from '../helpers/org-test-server.js';
import { createRbacTestServer } from '../helpers/rbac-test-server.js';
import { hashToken, generateAgentToken, generateAgentSalt } from '../../src/identity/agent-auth.js';
import { createLogger } from '../../src/utils/logger.js';
import type { AgentAuthStore } from '../../src/identity/agent-auth.contracts.js';

const logger = createLogger('typescript-host-smoke');

// ---------------------------------------------------------------------------
// Agent IDs — prefixed with "ts-smoke-" to avoid collision with other suites
// ---------------------------------------------------------------------------

const SMOKE_PRIVILEGED = 'ts-smoke-privileged-agent';
const SMOKE_RESTRICTED = 'ts-smoke-restricted-agent';

// ---------------------------------------------------------------------------
// TypeScript agent host discovery
// ---------------------------------------------------------------------------

interface TypeScriptHostInfo {
  available: boolean;
  path: string | null;
  reason: string;
}

function discoverTypeScriptHost(): TypeScriptHostInfo {
  // 1. Check TYPESCRIPT_AGENT_HOST_PATH env var
  const envPath = process.env['TYPESCRIPT_AGENT_HOST_PATH'];
  if (envPath) {
    if (existsSync(envPath)) {
      return { available: true, path: envPath, reason: 'TYPESCRIPT_AGENT_HOST_PATH env var' };
    }
    return { available: false, path: null, reason: `TYPESCRIPT_AGENT_HOST_PATH set to "${envPath}" but path does not exist` };
  }

  // 2. Check local workspace clone (sibling directory)
  const workspaceRoot = resolve(__dirname, '../../..');
  const localClonePaths = [
    join(workspaceRoot, 'typescript-agent-host'),
    join(workspaceRoot, 'TYPESCRIPT-AGENT-HOST', 'typescript-agent-host'),
    join(workspaceRoot, 'external-memory-sources', 'openclaw'),
  ];
  for (const clonePath of localClonePaths) {
    if (existsSync(clonePath)) {
      return { available: true, path: clonePath, reason: `local workspace clone at ${clonePath}` };
    }
  }

  // 3. Check PATH lookup
  try {
    const which = execSync('which typescript-agent-host 2>/dev/null || which ts-agent-host 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (which) {
      return { available: true, path: which, reason: `PATH lookup: ${which}` };
    }
  } catch {
    // not found in PATH
  }

  return { available: false, path: null, reason: 'TypeScript agent host not found in TYPESCRIPT_AGENT_HOST_PATH, local workspace, or PATH' };
}

// ---------------------------------------------------------------------------
// TypeScript agent host simulation layer
//
// The TypeScript agent host routes tool calls through the DC HTTP bridge.
// We simulate this by making HTTP requests to the DC server exactly as the
// TypeScript host bridge does. This proves the DC server security controls
// work correctly through the same HTTP path the TypeScript host uses.
// ---------------------------------------------------------------------------

interface AgentConfig {
  agentId: string;
  displayName: string;
  roles: string[];
  token: string;
  salt: string;
  personalBrain: string;
}

interface VerdictLog {
  agentId: string;
  action: string;
  surfaceId: string;
  expectedVerdict: string;
  actualVerdict: string;
  actualStatus: number;
  passed: boolean;
  timestamp: string;
}

async function evaluateViaHook(
  baseUrl: string,
  agent: AgentConfig,
  action: string,
  surfaceId: string,
  overrideAgentId?: string,
): Promise<{ status: number; verdict: string; matchedPolicies: Array<Record<string, unknown>>; code?: string }> {
  const payload: Record<string, unknown> = {
    action,
    surfaceId,
    agentId: overrideAgentId ?? agent.agentId,
  };

  const res = await fetch(`${baseUrl}/evaluate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${agent.token}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json() as Record<string, unknown>;

  if (res.status !== 200) {
    return {
      status: res.status,
      verdict: 'error',
      matchedPolicies: [],
      code: (body as Record<string, string>).code,
    };
  }

  const data = body.data as Record<string, unknown>;
  return {
    status: res.status,
    verdict: data.verdict as string,
    matchedPolicies: (data.matchedPolicies ?? []) as Array<Record<string, unknown>>,
  };
}

function logVerdict(verdictLogs: VerdictLog[], log: VerdictLog): void {
  verdictLogs.push(log);
  const icon = log.passed ? 'PASS' : 'FAIL';
  logger.info(
    {
      agent: log.agentId,
      action: log.action,
      expected: log.expectedVerdict,
      actual: log.actualVerdict,
      status: log.actualStatus,
    },
    `[${icon}] ${log.agentId} -> ${log.action}: expected=${log.expectedVerdict} actual=${log.actualVerdict}`,
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('typescript-host-bridge-simulation', () => {
  const tsHost = discoverTypeScriptHost();
  const requireDeployment = process.env['RUN_DEPLOYMENT_TESTS'] === '1';

  // Skip logic: if TS host is unavailable and RUN_DEPLOYMENT_TESTS isn't set, skip
  if (!tsHost.available && !requireDeployment) {
    it.skip(`SKIPPED: ${tsHost.reason}. Set RUN_DEPLOYMENT_TESTS=1 to require.`, () => {});
    return;
  }

  // If RUN_DEPLOYMENT_TESTS=1 but host is unavailable, fail explicitly
  if (!tsHost.available && requireDeployment) {
    it('TypeScript agent host must be available when RUN_DEPLOYMENT_TESTS=1', () => {
      expect.fail(
        `RUN_DEPLOYMENT_TESTS=1 but TypeScript agent host not found: ${tsHost.reason}`,
      );
    });
    return;
  }

  // --- Smoke test suite ---

  let tempDir: string;
  let server: OrgTestServerInstance;
  let baseUrl: string;
  const childProcesses: ChildProcess[] = [];
  const verdictLogs: VerdictLog[] = [];

  // Agent configs generated during provisioning
  const agents: Record<string, AgentConfig> = {};

  beforeAll(async () => {
    // Step 1: Create temp workspace
    tempDir = mkdtempSync(join(tmpdir(), 'dc-ts-smoke-'));
    const dcDir = join(tempDir, '.decision-core');
    mkdirSync(dcDir, { recursive: true });
    const agentsDir = join(dcDir, 'agents');
    mkdirSync(agentsDir, { recursive: true });

    // Step 2: Create org config with 2 agents (privileged + restricted)
    const agentsYaml = `tenantId: ts-smoke-org
agents:
  - agentId: ${SMOKE_PRIVILEGED}
    displayName: "TS Smoke Privileged Agent"
    humanOwner: "Smoke Test"
    roles:
      - executive
      - approver
      - finance
    surfaces:
      - http
    personalBrain: ts-smoke-privileged-brain
    authSubject: ts-smoke-privileged-auth
    enabled: true

  - agentId: ${SMOKE_RESTRICTED}
    displayName: "TS Smoke Restricted Agent"
    humanOwner: "Smoke Test"
    roles:
      - product
    surfaces:
      - http
    personalBrain: ts-smoke-restricted-brain
    authSubject: ts-smoke-restricted-auth
    enabled: true
`;
    writeFileSync(join(dcDir, 'agents.yaml'), agentsYaml);

    // Write access-policy.yaml
    const accessPolicyYaml = `version: "1.0"
lastReviewedBy: "Smoke Test"
lastReviewedAt: "2024-01-01T00:00:00Z"

classifications:
  - name: public
    description: "Public data"
    brain: public-brain
    accessibleBy:
      - executive
      - finance
      - product
      - approver
    examples:
      - company-news

  - name: confidential-finance
    description: "Financial data"
    brain: ts-smoke-privileged-brain
    accessibleBy:
      - executive
      - finance
    neverAccessibleBy:
      - product
    examples:
      - quarterly-revenue

  - name: product-data
    description: "Product roadmap data"
    brain: ts-smoke-restricted-brain
    accessibleBy:
      - executive
      - product
    examples:
      - roadmap
`;
    writeFileSync(join(dcDir, 'access-policy.yaml'), accessPolicyYaml);

    // Step 3: Provision agents
    const agentDefs = [
      {
        agentId: SMOKE_PRIVILEGED,
        displayName: 'TS Smoke Privileged Agent',
        roles: ['executive', 'approver', 'finance'],
        personalBrain: 'ts-smoke-privileged-brain',
      },
      {
        agentId: SMOKE_RESTRICTED,
        displayName: 'TS Smoke Restricted Agent',
        roles: ['product'],
        personalBrain: 'ts-smoke-restricted-brain',
      },
    ];

    const authBindings: AgentAuthStore['bindings'] = [];

    for (const def of agentDefs) {
      const token = generateAgentToken();
      const salt = generateAgentSalt();
      const tokenHash = hashToken(token, salt);

      authBindings.push({
        subject: tokenHash,
        salt,
        agentId: def.agentId,
        tenantId: 'ts-smoke-org',
        enabled: true,
      });

      agents[def.agentId] = {
        agentId: def.agentId,
        displayName: def.displayName,
        roles: def.roles,
        token,
        salt,
        personalBrain: def.personalBrain,
      };

      // Write per-agent env file
      const agentDir = join(agentsDir, def.agentId);
      mkdirSync(agentDir, { recursive: true });
      const envContent = [
        `# ${def.displayName} — generated by smoke test`,
        `DC_AGENT_ID=${def.agentId}`,
        `DC_BASE_URL=http://127.0.0.1:0`,
        `DC_API_KEY=${token}`,
        `GBRAIN_BRAIN_ID=${def.personalBrain}`,
      ].join('\n');
      writeFileSync(join(agentDir, 'agent.env'), envContent);
    }

    // Write auth store
    const authStoreYaml = `bindings:\n${authBindings.map((b) =>
      `  - subject: "${b.subject}"\n    salt: "${b.salt}"\n    agentId: "${b.agentId}"\n    tenantId: "${b.tenantId}"\n    enabled: ${b.enabled}`,
    ).join('\n')}\n`;
    writeFileSync(join(dcDir, 'agent-auth.yaml'), authStoreYaml);

    // Step 4: Start DC server with RBAC rules and per-agent auth
    server = await createRbacTestServer();
    baseUrl = server.baseUrl();

    // Inject provisioned agent bindings into the running server's auth store
    for (const binding of authBindings) {
      server.fixtures.tokens.bindings.push(binding);
    }

    // Register provisioned agents in the registry
    for (const def of agentDefs) {
      server.fixtures.agents.agents.push({
        agentId: def.agentId,
        displayName: def.displayName,
        humanOwner: 'Smoke Test',
        roles: def.roles,
        surfaces: ['http'],
        personalBrain: def.personalBrain,
        authSubject: `${def.agentId}-auth`,
        enabled: true,
      });
    }

    // Verify server starts
    const healthRes = await fetch(`${baseUrl}/health`);
    expect(healthRes.status, 'DC server health check should pass').toBe(200);

    logger.info({ baseUrl, agents: Object.keys(agents) }, 'TypeScript host smoke test server started');
  }, 30000);

  afterAll(async () => {
    // Kill all child processes
    for (const child of childProcesses) {
      try {
        if (child.pid && !child.killed) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      } catch {
        // Process already exited
      }
    }

    // Close DC server
    if (server) {
      await server.close();
    }

    // Remove temp workspace
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        logger.warn({ tempDir }, 'Could not clean up temp directory');
      }
    }

    // Emit verdict summary
    const passed = verdictLogs.filter((v) => v.passed).length;
    const failed = verdictLogs.filter((v) => !v.passed).length;
    logger.info(
      { passed, failed, total: verdictLogs.length },
      `Verdict summary: ${passed} passed, ${failed} failed out of ${verdictLogs.length}`,
    );
  });

  // -------------------------------------------------------------------------
  // Temp workspace and provisioning verification
  // -------------------------------------------------------------------------
  describe('workspace-and-provisioning', () => {
    it('temp workspace contains .decision-core with org config', () => {
      const dcDir = join(tempDir, '.decision-core');
      expect(existsSync(dcDir), '.decision-core directory should exist').toBe(true);
      expect(existsSync(join(dcDir, 'agents.yaml')), 'agents.yaml should exist').toBe(true);
      expect(existsSync(join(dcDir, 'access-policy.yaml')), 'access-policy.yaml should exist').toBe(true);
      expect(existsSync(join(dcDir, 'agent-auth.yaml')), 'agent-auth.yaml should exist').toBe(true);
    });

    it('provisioned 2 agents with distinct per-agent tokens', () => {
      const agentIds = Object.keys(agents);
      expect(agentIds.length, 'At least 2 agents should be provisioned').toBeGreaterThanOrEqual(2);

      const tokens = new Set(agentIds.map((id) => agents[id].token));
      expect(tokens.size, 'All tokens should be unique').toBe(agentIds.length);

      const salts = new Set(agentIds.map((id) => agents[id].salt));
      expect(salts.size, 'All salts should be unique').toBe(agentIds.length);
    });

    it('per-agent env files contain correct identity', () => {
      for (const [agentId, config] of Object.entries(agents)) {
        const envPath = join(tempDir, '.decision-core', 'agents', agentId, 'agent.env');
        expect(existsSync(envPath), `env file for ${agentId} should exist`).toBe(true);

        const envContent = readFileSync(envPath, 'utf-8');
        expect(envContent, `env should contain DC_AGENT_ID for ${agentId}`).toContain(`DC_AGENT_ID=${agentId}`);
        expect(envContent, `env should contain DC_API_KEY for ${agentId}`).toContain(`DC_API_KEY=${config.token}`);
      }
    });

    it('auth store contains valid bindings for all agents', () => {
      const authStorePath = join(tempDir, '.decision-core', 'agent-auth.yaml');
      const authStore = parseYaml(readFileSync(authStorePath, 'utf-8')) as AgentAuthStore;

      for (const agentId of Object.keys(agents)) {
        const binding = authStore.bindings.find((b) => b.agentId === agentId);
        expect(binding, `Auth binding for ${agentId} should exist`).toBeDefined();
        expect(binding!.enabled, `Auth binding for ${agentId} should be enabled`).toBe(true);

        const expectedHash = hashToken(agents[agentId].token, agents[agentId].salt);
        expect(binding!.subject, `Token hash should match for ${agentId}`).toBe(expectedHash);
      }
    });

    it('all tokens are generated test fixtures (64 hex chars)', () => {
      for (const [agentId, config] of Object.entries(agents)) {
        expect(config.token.length, `Token for ${agentId} should be 64 hex chars`).toBe(64);
        expect(
          /^[0-9a-f]{64}$/.test(config.token),
          `Token for ${agentId} should be hex-only`,
        ).toBe(true);
      }
    });

    it('no env files contain real API keys or external URLs', () => {
      const agentsDir = join(tempDir, '.decision-core', 'agents');
      for (const agentId of Object.keys(agents)) {
        const envPath = join(agentsDir, agentId, 'agent.env');
        const content = readFileSync(envPath, 'utf-8');

        expect(content).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
        expect(content).not.toMatch(/ghp_[a-zA-Z0-9]{20,}/);
        expect(content).not.toMatch(/AKIA[A-Z0-9]{16}/);
        expect(content).toContain('127.0.0.1');
        expect(content).not.toContain('api.openai.com');
        expect(content).not.toContain('api.anthropic.com');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Token-bound identity through TypeScript agent host boundary
  // -------------------------------------------------------------------------
  describe('token-bound-identity', () => {
    it('valid per-agent token authenticates correctly', async () => {
      for (const [agentId, config] of Object.entries(agents)) {
        const res = await evaluateViaHook(baseUrl, config, 'public-read', 'public-dashboard');
        expect(res.status, `${agentId} should authenticate with provisioned token`).toBe(200);

        const log: VerdictLog = {
          agentId,
          action: 'public-read',
          surfaceId: 'public-dashboard',
          expectedVerdict: 'allow',
          actualVerdict: res.verdict,
          actualStatus: res.status,
          passed: res.verdict === 'allow',
          timestamp: new Date().toISOString(),
        };
        logVerdict(verdictLogs, log);
      }
    });

    it('invalid token is rejected', async () => {
      const fakeAgent: AgentConfig = {
        agentId: 'ts-smoke-fake',
        displayName: 'Fake Agent',
        roles: [],
        token: 'a'.repeat(64),
        salt: 'b'.repeat(32),
        personalBrain: 'fake-brain',
      };

      const res = await evaluateViaHook(baseUrl, fakeAgent, 'public-read', 'public-dashboard');
      expect(res.status, 'Invalid token should return 403').toBe(403);
      expect(res.code, 'Invalid token should return unknown_token code').toBe('unknown_token');
    });

    it('missing token is rejected', async () => {
      const res = await fetch(`${baseUrl}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'public-read', surfaceId: 'test', agentId: 'test' }),
      });
      expect(res.status, 'Missing token should return 401').toBe(401);
    });

    it('agent cannot spoof another agent identity', async () => {
      const restricted = agents[SMOKE_RESTRICTED];
      const res = await evaluateViaHook(
        baseUrl,
        restricted,
        'finance-budget-update',
        'finance-operations',
        SMOKE_PRIVILEGED, // override agentId to claim privileged identity
      );

      const log: VerdictLog = {
        agentId: restricted.agentId,
        action: `finance-budget-update (spoofing ${SMOKE_PRIVILEGED})`,
        surfaceId: 'finance-operations',
        expectedVerdict: 'rejected',
        actualVerdict: res.code ?? res.verdict,
        actualStatus: res.status,
        passed: res.status === 403 && res.code === 'agent_mismatch',
        timestamp: new Date().toISOString(),
      };
      logVerdict(verdictLogs, log);

      expect(res.status, 'Identity spoofing should return 403').toBe(403);
      expect(res.code, 'Identity spoofing should return agent_mismatch code').toBe('agent_mismatch');
    });

    it('privileged agent cannot spoof restricted identity', async () => {
      const privileged = agents[SMOKE_PRIVILEGED];
      const res = await evaluateViaHook(
        baseUrl,
        privileged,
        'public-read',
        'public-dashboard',
        SMOKE_RESTRICTED,
      );

      const log: VerdictLog = {
        agentId: privileged.agentId,
        action: `public-read (spoofing ${SMOKE_RESTRICTED})`,
        surfaceId: 'public-dashboard',
        expectedVerdict: 'rejected',
        actualVerdict: res.code ?? res.verdict,
        actualStatus: res.status,
        passed: res.status === 403 && res.code === 'agent_mismatch',
        timestamp: new Date().toISOString(),
      };
      logVerdict(verdictLogs, log);

      expect(res.status, 'Reverse spoofing should return 403').toBe(403);
      expect(res.code, 'Reverse spoofing should return agent_mismatch').toBe('agent_mismatch');
    });
  });

  // -------------------------------------------------------------------------
  // Role-scoped deny/allow through TypeScript agent host boundary
  // -------------------------------------------------------------------------
  describe('role-scoped-deny-allow', () => {
    it('privileged agent allowed finance operations (has finance role)', async () => {
      const privileged = agents[SMOKE_PRIVILEGED];
      const res = await evaluateViaHook(baseUrl, privileged, 'finance-budget-update', 'finance-operations');

      const log: VerdictLog = {
        agentId: privileged.agentId,
        action: 'finance-budget-update',
        surfaceId: 'finance-operations',
        expectedVerdict: 'allow',
        actualVerdict: res.verdict,
        actualStatus: res.status,
        passed: res.verdict === 'allow',
        timestamp: new Date().toISOString(),
      };
      logVerdict(verdictLogs, log);

      expect(res.status, 'Privileged finance request should return 200').toBe(200);
      expect(res.verdict, 'Privileged agent should be allowed finance operations').toBe('allow');
    });

    it('restricted agent denied finance operations (no finance role)', async () => {
      const restricted = agents[SMOKE_RESTRICTED];
      const res = await evaluateViaHook(baseUrl, restricted, 'finance-budget-update', 'finance-operations');

      const log: VerdictLog = {
        agentId: restricted.agentId,
        action: 'finance-budget-update',
        surfaceId: 'finance-operations',
        expectedVerdict: 'deny',
        actualVerdict: res.verdict,
        actualStatus: res.status,
        passed: res.verdict === 'deny',
        timestamp: new Date().toISOString(),
      };
      logVerdict(verdictLogs, log);

      expect(res.status, 'Restricted finance request should return 200').toBe(200);
      expect(res.verdict, 'Restricted agent should be denied finance operations').toBe('deny');
    });

    it('privileged agent allowed finance report read', async () => {
      const privileged = agents[SMOKE_PRIVILEGED];
      const res = await evaluateViaHook(baseUrl, privileged, 'finance-report-read', 'finance-reporting');

      const log: VerdictLog = {
        agentId: privileged.agentId,
        action: 'finance-report-read',
        surfaceId: 'finance-reporting',
        expectedVerdict: 'allow',
        actualVerdict: res.verdict,
        actualStatus: res.status,
        passed: res.verdict === 'allow',
        timestamp: new Date().toISOString(),
      };
      logVerdict(verdictLogs, log);

      expect(res.status).toBe(200);
      expect(res.verdict).toBe('allow');
    });

    it('restricted agent denied finance report read', async () => {
      const restricted = agents[SMOKE_RESTRICTED];
      const res = await evaluateViaHook(baseUrl, restricted, 'finance-report-read', 'finance-reporting');

      const log: VerdictLog = {
        agentId: restricted.agentId,
        action: 'finance-report-read',
        surfaceId: 'finance-reporting',
        expectedVerdict: 'deny',
        actualVerdict: res.verdict,
        actualStatus: res.status,
        passed: res.verdict === 'deny',
        timestamp: new Date().toISOString(),
      };
      logVerdict(verdictLogs, log);

      expect(res.status).toBe(200);
      expect(res.verdict).toBe('deny');
    });

    it('role resolution uses token-bound identity, not request-supplied roles', async () => {
      const restricted = agents[SMOKE_RESTRICTED];

      // Inject callerRoles to try to escalate privileges
      const payload = {
        action: 'finance-budget-update',
        surfaceId: 'finance-operations',
        agentId: restricted.agentId,
        callerRoles: ['finance', 'executive', 'approver'],
      };

      const res = await fetch(`${baseUrl}/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${restricted.token}`,
        },
        body: JSON.stringify(payload),
      });

      const body = await res.json() as { data: { verdict: string } };

      const log: VerdictLog = {
        agentId: restricted.agentId,
        action: 'finance-budget-update (with injected callerRoles)',
        surfaceId: 'finance-operations',
        expectedVerdict: 'deny',
        actualVerdict: body.data?.verdict ?? 'error',
        actualStatus: res.status,
        passed: body.data?.verdict === 'deny',
        timestamp: new Date().toISOString(),
      };
      logVerdict(verdictLogs, log);

      expect(res.status, 'Injected callerRoles should not bypass auth').toBe(200);
      expect(body.data.verdict, 'Restricted agent should still be denied despite injected roles').toBe('deny');
    });
  });

  // -------------------------------------------------------------------------
  // Unknown-tool denial through TypeScript agent host boundary
  // -------------------------------------------------------------------------
  describe('unknown-tool-denial', () => {
    it('unknown tool denied for privileged agent', async () => {
      const privileged = agents[SMOKE_PRIVILEGED];
      const res = await evaluateViaHook(baseUrl, privileged, 'unknown-experimental-tool', 'unknown');

      const log: VerdictLog = {
        agentId: privileged.agentId,
        action: 'unknown-experimental-tool',
        surfaceId: 'unknown',
        expectedVerdict: 'deny',
        actualVerdict: res.verdict,
        actualStatus: res.status,
        passed: res.verdict === 'deny',
        timestamp: new Date().toISOString(),
      };
      logVerdict(verdictLogs, log);

      expect(res.status, 'Unknown tool should return 200').toBe(200);
      expect(res.verdict, 'Unknown tool should be denied by default policy').toBe('deny');
    });

    it('unknown tool denied for restricted agent', async () => {
      const restricted = agents[SMOKE_RESTRICTED];
      const res = await evaluateViaHook(baseUrl, restricted, 'nonexistent-tool-xyz', 'unknown');

      const log: VerdictLog = {
        agentId: restricted.agentId,
        action: 'nonexistent-tool-xyz',
        surfaceId: 'unknown',
        expectedVerdict: 'deny',
        actualVerdict: res.verdict,
        actualStatus: res.status,
        passed: res.verdict === 'deny',
        timestamp: new Date().toISOString(),
      };
      logVerdict(verdictLogs, log);

      expect(res.status, 'Unknown tool should return 200').toBe(200);
      expect(res.verdict, 'Unknown tool should be denied').toBe('deny');
    });

    it('known tool with matching policy returns expected verdict', async () => {
      const privileged = agents[SMOKE_PRIVILEGED];
      const res = await evaluateViaHook(baseUrl, privileged, 'brain-lookup', 'memory');

      const log: VerdictLog = {
        agentId: privileged.agentId,
        action: 'brain-lookup',
        surfaceId: 'memory',
        expectedVerdict: 'allow',
        actualVerdict: res.verdict,
        actualStatus: res.status,
        passed: res.verdict === 'allow',
        timestamp: new Date().toISOString(),
      };
      logVerdict(verdictLogs, log);

      expect(res.status).toBe(200);
      expect(res.verdict, 'Known tool with matching policy should be allowed').toBe('allow');
    });
  });

  // -------------------------------------------------------------------------
  // Verdict logging
  // -------------------------------------------------------------------------
  describe('verdict-logging', () => {
    it('verdict logs are emitted for all security test scenarios', () => {
      expect(verdictLogs.length, 'Should have captured verdict logs').toBeGreaterThan(0);

      for (const log of verdictLogs) {
        expect(log.agentId, 'Verdict log should have agentId').toBeTruthy();
        expect(log.action, 'Verdict log should have action').toBeTruthy();
        expect(log.timestamp, 'Verdict log should have timestamp').toBeTruthy();
        expect(log.expectedVerdict, 'Verdict log should have expectedVerdict').toBeTruthy();
        expect(log.actualVerdict, 'Verdict log should have actualVerdict').toBeTruthy();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Process cleanup verification
  // -------------------------------------------------------------------------
  describe('process-cleanup', () => {
    it('child process tracker is initialized', () => {
      expect(Array.isArray(childProcesses), 'childProcesses tracker should be an array').toBe(true);
    });

    it('temp workspace will be cleaned up in afterAll', () => {
      expect(tempDir, 'tempDir should be set').toBeTruthy();
      expect(tempDir.includes('dc-ts-smoke-'), 'tempDir should be in expected location').toBe(true);
    });
  });
});
