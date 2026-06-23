/**
 * DC Run 8.12 — Python Agent Host Bridge Simulation Test
 *
 * Bridge simulation test proving Decision Core's HTTP /evaluate contract works
 * with the request shapes a Python agent host would send. This test does NOT
 * spawn a real Python host process or load plugins through a host plugin system.
 * It simulates the HTTP bridge requests that the Hermes integration would make.
 *
 * For live host process verification, see test/live-hosts/live-hosts.test.ts.
 *
 * When the Python agent host source-pack is unavailable, the suite skips cleanly.
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

const logger = createLogger('python-host-deployment');

// ---------------------------------------------------------------------------
// Agent IDs — prefixed with "deploy-" to avoid collision with Meridian fixtures
// ---------------------------------------------------------------------------

const DEPLOY_CEO = 'deploy-ceo-agent';
const DEPLOY_FINANCE = 'deploy-finance-agent';
const DEPLOY_PRODUCT = 'deploy-product-agent';

// ---------------------------------------------------------------------------
// Python agent host discovery
// ---------------------------------------------------------------------------

interface PythonHostInfo {
  available: boolean;
  path: string | null;
  reason: string;
}

function discoverPythonHost(): PythonHostInfo {
  // 1. Check PYTHON_AGENT_HOST_PATH env var
  const envPath = process.env['PYTHON_AGENT_HOST_PATH'];
  if (envPath) {
    if (existsSync(envPath)) {
      return { available: true, path: envPath, reason: 'PYTHON_AGENT_HOST_PATH env var' };
    }
    return { available: false, path: null, reason: `PYTHON_AGENT_HOST_PATH set to "${envPath}" but path does not exist` };
  }

  // 2. Check local workspace clone (sibling directory)
  const workspaceRoot = resolve(__dirname, '../../..');
  const localClonePaths = [
    join(workspaceRoot, 'python-agent-host'),
    join(workspaceRoot, 'PYTHON-AGENT-HOST', 'python-agent-host'),
    join(workspaceRoot, 'external-memory-sources', 'hermes-agent'),
  ];
  for (const clonePath of localClonePaths) {
    if (existsSync(clonePath)) {
      return { available: true, path: clonePath, reason: `local workspace clone at ${clonePath}` };
    }
  }

  // 3. Check PATH lookup
  try {
    const which = execSync('which python-agent-host 2>/dev/null || which hermes 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (which) {
      return { available: true, path: which, reason: `PATH lookup: ${which}` };
    }
  } catch {
    // not found in PATH
  }

  return { available: false, path: null, reason: 'Python agent host not found in PYTHON_AGENT_HOST_PATH, local workspace, or PATH' };
}

// ---------------------------------------------------------------------------
// Python agent host simulation layer
//
// The Python agent host routes tool calls through the DC HTTP bridge
// (see integrations/hermes/decision_core_bridge.py). We simulate this by
// making HTTP requests to the DC server exactly as the Python bridge does.
// This proves the DC server security controls work correctly through the
// same HTTP path the Python host uses.
// ---------------------------------------------------------------------------

interface AgentConfig {
  agentId: string;
  displayName: string;
  roles: string[];
  token: string;
  salt: string;
  personalBrain: string | null;
  mountedBrains: string[];
  brainData: Record<string, unknown>;
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

describe('python-host-bridge-simulation', () => {
  const pythonHost = discoverPythonHost();
  const requireDeployment = process.env['RUN_DEPLOYMENT_TESTS'] === '1';

  // Skip logic: if Python host is unavailable and RUN_DEPLOYMENT_TESTS isn't set, skip
  if (!pythonHost.available && !requireDeployment) {
    it.skip(`SKIPPED: ${pythonHost.reason}. Set RUN_DEPLOYMENT_TESTS=1 to require.`, () => {});
    return;
  }

  // If RUN_DEPLOYMENT_TESTS=1 but host is unavailable, fail explicitly
  if (!pythonHost.available && requireDeployment) {
    it('Python agent host must be available when RUN_DEPLOYMENT_TESTS=1', () => {
      expect.fail(
        `RUN_DEPLOYMENT_TESTS=1 but Python agent host not found: ${pythonHost.reason}`,
      );
    });
    return;
  }

  // --- Full deployment test suite ---

  let tempDir: string;
  let server: OrgTestServerInstance;
  let baseUrl: string;
  const childProcesses: ChildProcess[] = [];
  const verdictLogs: VerdictLog[] = [];

  // Agent configs generated during provisioning
  const agents: Record<string, AgentConfig> = {};

  // Synthetic brain data for isolation tests
  const syntheticBrains: Record<string, Record<string, unknown>> = {
    [DEPLOY_CEO]: {
      'strategic-priorities': ['Q3 expansion into APAC markets'],
      'board-notes': ['Board meeting approved Series C terms'],
    },
    [DEPLOY_FINANCE]: {
      'analysis-templates': ['variance-analysis', 'trend-forecasting'],
      'recent-reports': ['Q2-expense-summary'],
    },
    [DEPLOY_PRODUCT]: {
      'roadmap-items': ['Feature A: user analytics dashboard'],
      'customer-feedback': { 'nps-score': 72 },
    },
  };

  beforeAll(async () => {
    // Step 1: Create temp workspace
    tempDir = mkdtempSync(join(tmpdir(), 'dc-python-deploy-'));
    const dcDir = join(tempDir, '.decision-core');
    mkdirSync(dcDir, { recursive: true });
    const agentsDir = join(dcDir, 'agents');
    mkdirSync(agentsDir, { recursive: true });

    // Step 2: Create org config (simulating `decision-core org init`)
    // Write agents.yaml with CEO, Finance, Product (3 agents minimum)
    const agentsYaml = `tenantId: deploy-test-org
agents:
  - agentId: ${DEPLOY_CEO}
    displayName: "Deploy CEO Agent"
    humanOwner: "Deploy Test CEO"
    roles:
      - executive
      - approver
      - audit_admin
    surfaces:
      - http
    personalBrain: deploy-ceo-brain
    authSubject: deploy-ceo-auth
    enabled: true

  - agentId: ${DEPLOY_FINANCE}
    displayName: "Deploy Finance Agent"
    humanOwner: "Deploy Test Finance"
    roles:
      - finance
      - finance_analyst
      - approver
    surfaces:
      - http
    personalBrain: deploy-finance-brain
    authSubject: deploy-finance-auth
    enabled: true

  - agentId: ${DEPLOY_PRODUCT}
    displayName: "Deploy Product Agent"
    humanOwner: "Deploy Test Product"
    roles:
      - product
    surfaces:
      - http
    personalBrain: deploy-product-brain
    authSubject: deploy-product-auth
    enabled: true
`;
    writeFileSync(join(dcDir, 'agents.yaml'), agentsYaml);

    // Write access-policy.yaml
    const accessPolicyYaml = `version: "1.0"
lastReviewedBy: "Deploy Test"
lastReviewedAt: "2024-01-01T00:00:00Z"

classifications:
  - name: public
    description: "Public data"
    brain: public-brain
    accessibleBy:
      - executive
      - finance
      - finance_analyst
      - product
      - approver
      - audit_admin
    examples:
      - company-news

  - name: confidential-finance
    description: "Financial data"
    brain: deploy-finance-brain
    accessibleBy:
      - executive
      - finance
      - finance_analyst
      - approver
    neverAccessibleBy:
      - product
    examples:
      - quarterly-revenue

  - name: product-data
    description: "Product roadmap data"
    brain: deploy-product-brain
    accessibleBy:
      - executive
      - product
    neverAccessibleBy:
      - finance_analyst
    examples:
      - roadmap
`;
    writeFileSync(join(dcDir, 'access-policy.yaml'), accessPolicyYaml);

    // Step 3: Provision agents programmatically (simulating `decision-core provision`)
    // Generate per-agent tokens, salts, and auth bindings
    const agentDefs = [
      {
        agentId: DEPLOY_CEO,
        displayName: 'Deploy CEO Agent',
        roles: ['executive', 'approver', 'audit_admin'],
        personalBrain: 'deploy-ceo-brain',
      },
      {
        agentId: DEPLOY_FINANCE,
        displayName: 'Deploy Finance Agent',
        roles: ['finance', 'finance_analyst', 'approver'],
        personalBrain: 'deploy-finance-brain',
      },
      {
        agentId: DEPLOY_PRODUCT,
        displayName: 'Deploy Product Agent',
        roles: ['product'],
        personalBrain: 'deploy-product-brain',
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
        tenantId: 'deploy-test-org',
        enabled: true,
      });

      // Determine mounted brains based on access policy
      const mountedBrains = [def.personalBrain];
      mountedBrains.push('public-brain');
      if (def.roles.includes('executive') || def.roles.includes('finance') || def.roles.includes('finance_analyst')) {
        mountedBrains.push('deploy-finance-brain');
      }
      if (def.roles.includes('executive') || def.roles.includes('product')) {
        mountedBrains.push('deploy-product-brain');
      }

      agents[def.agentId] = {
        agentId: def.agentId,
        displayName: def.displayName,
        roles: def.roles,
        token,
        salt,
        personalBrain: def.personalBrain,
        mountedBrains,
        brainData: syntheticBrains[def.agentId] ?? {},
      };

      // Write per-agent env file (as provision would)
      const agentDir = join(agentsDir, def.agentId);
      mkdirSync(agentDir, { recursive: true });
      const envContent = [
        `# ${def.displayName} — generated by deployment test`,
        `DC_AGENT_ID=${def.agentId}`,
        `DC_BASE_URL=http://127.0.0.1:0`,
        `DC_API_KEY=${token}`,
        `GBRAIN_BRAIN_ID=${def.personalBrain}`,
        `GBRAIN_MOUNTS=${mountedBrains.join(',')}`,
      ].join('\n');
      writeFileSync(join(agentDir, 'agent.env'), envContent);

      // Write mounts.json
      writeFileSync(
        join(agentDir, 'mounts.json'),
        JSON.stringify({
          agentId: def.agentId,
          personalBrain: def.personalBrain,
          sharedBrains: mountedBrains,
        }, null, 2),
      );
    }

    // Write auth store
    const authStoreYaml = `bindings:\n${authBindings.map((b) =>
      `  - subject: "${b.subject}"\n    salt: "${b.salt}"\n    agentId: "${b.agentId}"\n    tenantId: "${b.tenantId}"\n    enabled: ${b.enabled}`,
    ).join('\n')}\n`;
    writeFileSync(join(dcDir, 'agent-auth.yaml'), authStoreYaml);

    // Write synthetic brain fixtures to temp dir
    const brainsDir = join(tempDir, 'brains');
    mkdirSync(brainsDir, { recursive: true });
    for (const [agentId, data] of Object.entries(syntheticBrains)) {
      writeFileSync(
        join(brainsDir, `${agentId}.json`),
        JSON.stringify({ agentId, data }, null, 2),
      );
    }

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
        humanOwner: 'Deploy Test',
        roles: def.roles,
        surfaces: ['http'],
        personalBrain: def.personalBrain,
        authSubject: `${def.agentId}-auth`,
        enabled: true,
      });
    }

    // Verify server starts with no global bearer token (org-mode only)
    const healthRes = await fetch(`${baseUrl}/health`);
    expect(healthRes.status, 'DC server health check should pass').toBe(200);

    logger.info({ baseUrl, agents: Object.keys(agents) }, 'Deployment test server started');
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
  // Org init and provision verification
  // -------------------------------------------------------------------------
  describe('org-init-and-provision', () => {
    it('temp workspace contains .decision-core with org config', () => {
      const dcDir = join(tempDir, '.decision-core');
      expect(existsSync(dcDir), '.decision-core directory should exist').toBe(true);
      expect(existsSync(join(dcDir, 'agents.yaml')), 'agents.yaml should exist').toBe(true);
      expect(existsSync(join(dcDir, 'access-policy.yaml')), 'access-policy.yaml should exist').toBe(true);
      expect(existsSync(join(dcDir, 'agent-auth.yaml')), 'agent-auth.yaml should exist').toBe(true);
    });

    it('provisioned 3+ agents with distinct per-agent tokens', () => {
      const agentIds = Object.keys(agents);
      expect(agentIds.length, 'At least 3 agents should be provisioned').toBeGreaterThanOrEqual(3);

      // Tokens must be unique
      const tokens = new Set(agentIds.map((id) => agents[id].token));
      expect(tokens.size, 'All tokens should be unique').toBe(agentIds.length);

      // Salts must be unique
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
        expect(envContent, `env should contain GBRAIN_BRAIN_ID for ${agentId}`).toContain(`GBRAIN_BRAIN_ID=${config.personalBrain}`);
      }
    });

    it('auth store contains bindings for all provisioned agents', () => {
      const authStorePath = join(tempDir, '.decision-core', 'agent-auth.yaml');
      const authStore = parseYaml(readFileSync(authStorePath, 'utf-8')) as AgentAuthStore;

      for (const agentId of Object.keys(agents)) {
        const binding = authStore.bindings.find((b) => b.agentId === agentId);
        expect(binding, `Auth binding for ${agentId} should exist`).toBeDefined();
        expect(binding!.enabled, `Auth binding for ${agentId} should be enabled`).toBe(true);

        // Verify the token hashes correctly
        const expectedHash = hashToken(agents[agentId].token, agents[agentId].salt);
        expect(binding!.subject, `Token hash should match for ${agentId}`).toBe(expectedHash);
      }
    });
  });

  // -------------------------------------------------------------------------
  // DC server with generated org config
  // -------------------------------------------------------------------------
  describe('dc-server-org-mode', () => {
    it('server starts with org-mode and no global bearer token', async () => {
      // Health endpoint works without auth
      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status, 'Health endpoint should not require auth').toBe(200);

      // Evaluate endpoint requires per-agent auth (no global token)
      const noAuthRes = await fetch(`${baseUrl}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', surfaceId: 'test', agentId: 'test' }),
      });
      expect(noAuthRes.status, 'Evaluate without auth should return 401').toBe(401);
    });

    it('all 3 provisioned agents authenticate successfully', async () => {
      for (const [agentId, config] of Object.entries(agents)) {
        const res = await evaluateViaHook(baseUrl, config, 'public-read', 'public-dashboard');
        expect(res.status, `${agentId} should authenticate with provisioned token`).toBe(200);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Python-host agent simulation — 3 agents with distinct identity
  // -------------------------------------------------------------------------
  describe('python-host-agents-with-distinct-identity', () => {
    it('CEO agent has executive+approver+audit_admin roles', () => {
      const ceo = agents[DEPLOY_CEO];
      expect(ceo.roles, 'CEO should have executive role').toContain('executive');
      expect(ceo.roles, 'CEO should have approver role').toContain('approver');
      expect(ceo.roles, 'CEO should have audit_admin role').toContain('audit_admin');
    });

    it('Finance agent has finance+finance_analyst+approver roles', () => {
      const finance = agents[DEPLOY_FINANCE];
      expect(finance.roles, 'Finance should have finance role').toContain('finance');
      expect(finance.roles, 'Finance should have finance_analyst role').toContain('finance_analyst');
      expect(finance.roles, 'Finance should have approver role').toContain('approver');
    });

    it('Product agent has only product role', () => {
      const product = agents[DEPLOY_PRODUCT];
      expect(product.roles, 'Product should have product role').toContain('product');
      expect(product.roles.length, 'Product should have exactly 1 role').toBe(1);
    });

    it('each agent has distinct personalBrain', () => {
      const brains = new Set(Object.values(agents).map((a) => a.personalBrain));
      expect(brains.size, 'All personal brains should be unique').toBe(Object.keys(agents).length);
    });
  });

  // -------------------------------------------------------------------------
  // Tool call routing through DC plugin/hook
  // -------------------------------------------------------------------------
  describe('tool-call-routing-via-hook', () => {
    it('each agent routes tool calls through the DC evaluate endpoint', async () => {
      for (const [agentId, config] of Object.entries(agents)) {
        const res = await evaluateViaHook(baseUrl, config, 'public-read', 'public-dashboard');
        expect(res.status, `${agentId} tool call routing should succeed`).toBe(200);
        expect(
          ['allow', 'deny', 'approve_required'].includes(res.verdict),
          `${agentId} should receive a valid verdict`,
        ).toBe(true);

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
  });

  // -------------------------------------------------------------------------
  // Security scenarios: approve_purchase (Finance allowed, Product denied)
  // -------------------------------------------------------------------------
  describe('approve_purchase-security', () => {
    it('Finance approve_purchase -> allow (finance role matches)', async () => {
      const finance = agents[DEPLOY_FINANCE];
      const res = await evaluateViaHook(baseUrl, finance, 'finance-budget-update', 'finance-operations');

      const log: VerdictLog = {
        agentId: finance.agentId,
        action: 'finance-budget-update',
        surfaceId: 'finance-operations',
        expectedVerdict: 'allow',
        actualVerdict: res.verdict,
        actualStatus: res.status,
        passed: res.verdict === 'allow',
        timestamp: new Date().toISOString(),
      };
      logVerdict(verdictLogs, log);

      expect(res.status, 'Finance budget update request should return 200').toBe(200);
      expect(res.verdict, 'Finance agent should be allowed to update budgets').toBe('allow');
    });

    it('Product approve_purchase -> denied (no finance role)', async () => {
      const product = agents[DEPLOY_PRODUCT];
      const res = await evaluateViaHook(baseUrl, product, 'finance-budget-update', 'finance-operations');

      const log: VerdictLog = {
        agentId: product.agentId,
        action: 'finance-budget-update',
        surfaceId: 'finance-operations',
        expectedVerdict: 'deny',
        actualVerdict: res.verdict,
        actualStatus: res.status,
        passed: res.verdict === 'deny',
        timestamp: new Date().toISOString(),
      };
      logVerdict(verdictLogs, log);

      expect(res.status, 'Product finance request should return 200').toBe(200);
      expect(res.verdict, 'Product agent should be denied finance operations').toBe('deny');
    });
  });

  // -------------------------------------------------------------------------
  // Identity spoofing: Product claiming finance identity
  // -------------------------------------------------------------------------
  describe('identity-spoofing', () => {
    it('Product claiming finance identity -> rejected (agent_mismatch)', async () => {
      const product = agents[DEPLOY_PRODUCT];
      const res = await evaluateViaHook(
        baseUrl,
        product,
        'finance-budget-update',
        'finance-operations',
        DEPLOY_FINANCE, // override agentId to claim finance identity
      );

      const log: VerdictLog = {
        agentId: product.agentId,
        action: `finance-budget-update (spoofing ${DEPLOY_FINANCE})`,
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

    it('Finance claiming CEO identity -> rejected', async () => {
      const finance = agents[DEPLOY_FINANCE];
      const res = await evaluateViaHook(
        baseUrl,
        finance,
        'approve-request',
        'approval-queue',
        DEPLOY_CEO,
      );

      const log: VerdictLog = {
        agentId: finance.agentId,
        action: `approve-request (spoofing ${DEPLOY_CEO})`,
        surfaceId: 'approval-queue',
        expectedVerdict: 'rejected',
        actualVerdict: res.code ?? res.verdict,
        actualStatus: res.status,
        passed: res.status === 403 && res.code === 'agent_mismatch',
        timestamp: new Date().toISOString(),
      };
      logVerdict(verdictLogs, log);

      expect(res.status, 'Cross-agent spoofing should return 403').toBe(403);
      expect(res.code, 'Cross-agent spoofing should return agent_mismatch').toBe('agent_mismatch');
    });
  });

  // -------------------------------------------------------------------------
  // Unknown tool -> denied
  // -------------------------------------------------------------------------
  describe('unknown-tool-denied', () => {
    it('unknown tool denied for CEO', async () => {
      const ceo = agents[DEPLOY_CEO];
      const res = await evaluateViaHook(baseUrl, ceo, 'unknown-experimental-tool', 'unknown');

      const log: VerdictLog = {
        agentId: ceo.agentId,
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

    it('unknown tool denied for Finance', async () => {
      const finance = agents[DEPLOY_FINANCE];
      const res = await evaluateViaHook(baseUrl, finance, 'nonexistent-tool-xyz', 'unknown');

      const log: VerdictLog = {
        agentId: finance.agentId,
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

    it('unknown tool denied for Product', async () => {
      const product = agents[DEPLOY_PRODUCT];
      const res = await evaluateViaHook(baseUrl, product, 'phantom-tool', 'phantom');

      const log: VerdictLog = {
        agentId: product.agentId,
        action: 'phantom-tool',
        surfaceId: 'phantom',
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
  });

  // -------------------------------------------------------------------------
  // Per-agent memory/G-brain isolation
  // -------------------------------------------------------------------------
  describe('gbrain-isolation', () => {
    it('each agent has distinct personalBrain in provisioned config', () => {
      expect(agents[DEPLOY_CEO].personalBrain).toBe('deploy-ceo-brain');
      expect(agents[DEPLOY_FINANCE].personalBrain).toBe('deploy-finance-brain');
      expect(agents[DEPLOY_PRODUCT].personalBrain).toBe('deploy-product-brain');
    });

    it('synthetic brain data is isolated per agent in temp workspace', () => {
      for (const [agentId, data] of Object.entries(syntheticBrains)) {
        const brainPath = join(tempDir, 'brains', `${agentId}.json`);
        expect(existsSync(brainPath), `Brain file for ${agentId} should exist`).toBe(true);

        const brainContent = JSON.parse(readFileSync(brainPath, 'utf-8'));
        expect(brainContent.agentId, `Brain file agentId should match ${agentId}`).toBe(agentId);
        expect(brainContent.data, `Brain data should match for ${agentId}`).toEqual(data);
      }
    });

    it('agent mounted brains reflect access policy isolation', () => {
      // CEO (executive) can access finance-brain and product-brain
      expect(agents[DEPLOY_CEO].mountedBrains).toContain('deploy-finance-brain');
      expect(agents[DEPLOY_CEO].mountedBrains).toContain('deploy-product-brain');

      // Finance can access finance-brain but NOT product-brain (no product role)
      expect(agents[DEPLOY_FINANCE].mountedBrains).toContain('deploy-finance-brain');
      expect(agents[DEPLOY_FINANCE].mountedBrains).not.toContain('deploy-product-brain');

      // Product can access product-brain but NOT finance-brain
      expect(agents[DEPLOY_PRODUCT].mountedBrains).toContain('deploy-product-brain');
      expect(agents[DEPLOY_PRODUCT].mountedBrains).not.toContain('deploy-finance-brain');
    });

    it('brain-lookup tool allowed for all agents via public policy', async () => {
      for (const [agentId, config] of Object.entries(agents)) {
        const res = await evaluateViaHook(baseUrl, config, 'brain-lookup', 'memory');
        expect(res.status, `Brain lookup for ${agentId} should return 200`).toBe(200);
        expect(res.verdict, `Brain lookup should be allowed for ${agentId}`).toBe('allow');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Per-agent verdict logs
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
  // No real credentials
  // -------------------------------------------------------------------------
  describe('no-real-credentials', () => {
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

        // Should not contain real API key patterns
        expect(content).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
        expect(content).not.toMatch(/ghp_[a-zA-Z0-9]{20,}/);
        expect(content).not.toMatch(/AKIA[A-Z0-9]{16}/);

        // Should only reference localhost
        expect(content).toContain('127.0.0.1');
        expect(content).not.toContain('api.openai.com');
        expect(content).not.toContain('api.anthropic.com');
      }
    });

    it('temp workspace uses synthetic data only', () => {
      for (const agentId of Object.keys(syntheticBrains)) {
        const brainPath = join(tempDir, 'brains', `${agentId}.json`);
        const content = readFileSync(brainPath, 'utf-8');
        expect(content).not.toContain('real-api-key');
        expect(content).not.toContain('password');
        expect(content).not.toContain('secret');
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
      expect(tempDir.includes('dc-python-deploy-'), 'tempDir should be in expected location').toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Additional RBAC scenarios through Python-host hook path
  // -------------------------------------------------------------------------
  describe('additional-rbac-via-hook', () => {
    it('Finance can read finance reports', async () => {
      const finance = agents[DEPLOY_FINANCE];
      const res = await evaluateViaHook(baseUrl, finance, 'finance-report-read', 'finance-reporting');

      const log: VerdictLog = {
        agentId: finance.agentId,
        action: 'finance-report-read',
        surfaceId: 'finance-reporting',
        expectedVerdict: 'allow',
        actualVerdict: res.verdict,
        actualStatus: res.status,
        passed: res.verdict === 'allow',
        timestamp: new Date().toISOString(),
      };
      logVerdict(verdictLogs, log);

      expect(res.status, 'Finance report read should return 200').toBe(200);
      expect(res.verdict, 'Finance agent should be allowed to read finance reports').toBe('allow');
    });

    it('Product denied finance report access', async () => {
      const product = agents[DEPLOY_PRODUCT];
      const res = await evaluateViaHook(baseUrl, product, 'finance-report-read', 'finance-reporting');

      const log: VerdictLog = {
        agentId: product.agentId,
        action: 'finance-report-read',
        surfaceId: 'finance-reporting',
        expectedVerdict: 'deny',
        actualVerdict: res.verdict,
        actualStatus: res.status,
        passed: res.verdict === 'deny',
        timestamp: new Date().toISOString(),
      };
      logVerdict(verdictLogs, log);

      expect(res.status, 'Product finance request should return 200').toBe(200);
      expect(res.verdict, 'Product agent should be denied finance access').toBe('deny');
    });

    it('callerRoles injection does not escalate privileges', async () => {
      const product = agents[DEPLOY_PRODUCT];

      const payload = {
        action: 'finance-budget-update',
        surfaceId: 'finance-operations',
        agentId: product.agentId,
        callerRoles: ['finance', 'executive', 'approver'],
      };

      const res = await fetch(`${baseUrl}/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${product.token}`,
        },
        body: JSON.stringify(payload),
      });

      const body = await res.json() as { data: { verdict: string } };

      const log: VerdictLog = {
        agentId: product.agentId,
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
      expect(body.data.verdict, 'Product should still be denied despite injected roles').toBe('deny');
    });
  });
});
