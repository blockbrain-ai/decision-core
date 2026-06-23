/**
 * Release gate helpers for Phase 8 tests.
 *
 * Provides consistent env-flag gating so deployment tests and model evals
 * skip by default and fail (instead of skip) when the flag is set but
 * the required tool is missing. See docs/RELEASE-TESTING.md.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe as vitestDescribe, it as vitestIt } from 'vitest';

// ---------------------------------------------------------------------------
// Env flag readers
// ---------------------------------------------------------------------------

export function isDeploymentTestsEnabled(): boolean {
  return process.env.RUN_DEPLOYMENT_TESTS === '1';
}

export function isModelEvalsEnabled(): boolean {
  return process.env.RUN_MODEL_EVALS === '1';
}

export function isRemoteModelEvalsEnabled(): boolean {
  return process.env.RUN_REMOTE_MODEL_EVALS === '1';
}

// ---------------------------------------------------------------------------
// Tool detection
// ---------------------------------------------------------------------------

function whichSync(bin: string): string | null {
  try {
    return execSync(`which ${bin}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() || null;
  } catch {
    return null;
  }
}

export interface ToolDetection {
  found: boolean;
  path: string | null;
  source: 'env' | 'local' | 'path' | 'none';
}

function localWorkspaceHostPath(tool: 'python-host' | 'typescript-host'): string | null {
  if (process.env.DECISION_CORE_DISABLE_LOCAL_HOST_DISCOVERY === '1') return null;

  const workspaceRoot = resolve(process.cwd(), '..');
  const candidates = tool === 'python-host'
    ? [
        join(workspaceRoot, 'python-agent-host'),
        join(workspaceRoot, 'PYTHON-AGENT-HOST', 'python-agent-host'),
        join(workspaceRoot, 'external-memory-sources', 'hermes-agent'),
      ]
    : [
        join(workspaceRoot, 'typescript-agent-host'),
        join(workspaceRoot, 'TYPESCRIPT-AGENT-HOST', 'typescript-agent-host'),
        join(workspaceRoot, 'external-memory-sources', 'openclaw'),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function detectPythonAgentHost(): ToolDetection {
  const envPath = process.env.PYTHON_AGENT_HOST_PATH;
  if (envPath) {
    return existsSync(envPath)
      ? { found: true, path: envPath, source: 'env' }
      : { found: false, path: null, source: 'env' };
  }
  const localPath = localWorkspaceHostPath('python-host');
  if (localPath) return { found: true, path: localPath, source: 'local' };
  const pathBin = whichSync('python-agent-host');
  if (pathBin) return { found: true, path: pathBin, source: 'path' };
  return { found: false, path: null, source: 'none' };
}

export function detectTypeScriptAgentHost(): ToolDetection {
  const envPath = process.env.TYPESCRIPT_AGENT_HOST_PATH;
  if (envPath) {
    return existsSync(envPath)
      ? { found: true, path: envPath, source: 'env' }
      : { found: false, path: null, source: 'env' };
  }
  const localPath = localWorkspaceHostPath('typescript-host');
  if (localPath) return { found: true, path: localPath, source: 'local' };
  const pathBin = whichSync('typescript-agent-host');
  if (pathBin) return { found: true, path: pathBin, source: 'path' };
  return { found: false, path: null, source: 'none' };
}

export interface ModelProviderDetection {
  found: boolean;
  provider: string | null;
  source: 'local' | 'remote' | 'none';
}

export function detectModelProvider(): ModelProviderDetection {
  const local = process.env.LOCAL_MODEL_PROVIDER;
  if (local) return { found: true, provider: local, source: 'local' };
  const remote = process.env.REMOTE_MODEL_PROVIDER;
  if (isRemoteModelEvalsEnabled() && remote) {
    return { found: true, provider: remote, source: 'remote' };
  }
  return { found: false, provider: null, source: 'none' };
}

// ---------------------------------------------------------------------------
// Skip-or-fail guards (use in describe/it blocks)
// ---------------------------------------------------------------------------

export interface GateResult {
  shouldRun: boolean;
  skipReason: string | null;
}

/**
 * Check whether deployment tests should run.
 *
 * - Flag unset → skip with reason
 * - Flag set, tool missing → throw (fail, not skip)
 * - Flag set, tool found → run
 */
export function deploymentGate(tool: 'python-host' | 'typescript-host'): GateResult {
  if (!isDeploymentTestsEnabled()) {
    return { shouldRun: false, skipReason: `RUN_DEPLOYMENT_TESTS not set — skipping ${tool} deployment test` };
  }
  const detection = tool === 'python-host' ? detectPythonAgentHost() : detectTypeScriptAgentHost();
  if (!detection.found) {
    throw new Error(
      `RUN_DEPLOYMENT_TESTS=1 but ${tool} not found. ` +
      `Set ${tool === 'python-host' ? 'PYTHON_AGENT_HOST_PATH' : 'TYPESCRIPT_AGENT_HOST_PATH'} or install ${tool} in PATH.`,
    );
  }
  return { shouldRun: true, skipReason: null };
}

/**
 * Check whether model eval tests should run.
 *
 * - Flag unset → skip with reason
 * - Flag set, no provider → throw (fail, not skip)
 * - Flag set, provider found → run
 */
export function modelEvalGate(): GateResult {
  if (!isModelEvalsEnabled()) {
    return { shouldRun: false, skipReason: 'RUN_MODEL_EVALS not set — skipping model eval' };
  }
  const detection = detectModelProvider();
  if (!detection.found) {
    throw new Error(
      'RUN_MODEL_EVALS=1 but no model provider configured. ' +
      'Set LOCAL_MODEL_PROVIDER for local evals. Remote model evals require both RUN_REMOTE_MODEL_EVALS=1 and REMOTE_MODEL_PROVIDER.',
    );
  }
  return { shouldRun: true, skipReason: null };
}

// ---------------------------------------------------------------------------
// Vitest integration helper
// ---------------------------------------------------------------------------

/**
 * Conditionally skip a test suite based on a gate result.
 * Usage:
 *   const gate = deploymentGate('python-host');
 *   describeIf(gate.shouldRun)('Python-host deployment', () => { ... });
 *
 * When skipped, prints the skip reason once.
 */
export function describeIf(condition: boolean): typeof vitestDescribe {
  return condition ? vitestDescribe : vitestDescribe.skip;
}

export function itIf(condition: boolean): typeof vitestIt {
  return condition ? vitestIt : vitestIt.skip;
}
