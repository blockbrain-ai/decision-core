import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isDeploymentTestsEnabled,
  isModelEvalsEnabled,
  detectModelProvider,
  deploymentGate,
  modelEvalGate,
} from './release-gates.js';

// ---------------------------------------------------------------------------
// Save and restore env vars to avoid cross-test pollution
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  'RUN_DEPLOYMENT_TESTS',
  'RUN_MODEL_EVALS',
  'RUN_REMOTE_MODEL_EVALS',
  'PYTHON_AGENT_HOST_PATH',
  'TYPESCRIPT_AGENT_HOST_PATH',
  'DECISION_CORE_DISABLE_LOCAL_HOST_DISCOVERY',
  'LOCAL_MODEL_PROVIDER',
  'REMOTE_MODEL_PROVIDER',
] as const;

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
  const snap: EnvSnapshot = {};
  for (const key of ENV_KEYS) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const [key, val] of Object.entries(snap)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
}

function clearGateEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('release-gates', () => {
  let saved: EnvSnapshot;

  beforeEach(() => {
    saved = snapshotEnv();
    clearGateEnv();
  });

  afterEach(() => {
    restoreEnv(saved);
  });

  // ── flag readers ──

  describe('isDeploymentTestsEnabled', () => {
    it('returns false when unset', () => {
      expect(isDeploymentTestsEnabled()).toBe(false);
    });

    it('returns true when set to 1', () => {
      process.env.RUN_DEPLOYMENT_TESTS = '1';
      expect(isDeploymentTestsEnabled()).toBe(true);
    });

    it('returns false when set to other value', () => {
      process.env.RUN_DEPLOYMENT_TESTS = 'true';
      expect(isDeploymentTestsEnabled()).toBe(false);
    });
  });

  describe('isModelEvalsEnabled', () => {
    it('returns false when unset', () => {
      expect(isModelEvalsEnabled()).toBe(false);
    });

    it('returns true when set to 1', () => {
      process.env.RUN_MODEL_EVALS = '1';
      expect(isModelEvalsEnabled()).toBe(true);
    });
  });

  // ── model provider detection ──

  describe('detectModelProvider', () => {
    it('returns none when no provider configured', () => {
      const result = detectModelProvider();
      expect(result.found).toBe(false);
      expect(result.source).toBe('none');
    });

    it('prefers LOCAL_MODEL_PROVIDER', () => {
      process.env.LOCAL_MODEL_PROVIDER = 'ollama';
      process.env.RUN_REMOTE_MODEL_EVALS = '1';
      process.env.REMOTE_MODEL_PROVIDER = 'remote-test';
      const result = detectModelProvider();
      expect(result.found).toBe(true);
      expect(result.provider).toBe('ollama');
      expect(result.source).toBe('local');
    });

    it('ignores remote provider unless explicitly enabled', () => {
      process.env.REMOTE_MODEL_PROVIDER = 'remote-test';
      const result = detectModelProvider();
      expect(result.found).toBe(false);
      expect(result.source).toBe('none');
    });

    it('uses remote provider only with second opt-in flag', () => {
      process.env.RUN_REMOTE_MODEL_EVALS = '1';
      process.env.REMOTE_MODEL_PROVIDER = 'remote-test';
      const result = detectModelProvider();
      expect(result.found).toBe(true);
      expect(result.provider).toBe('remote-test');
      expect(result.source).toBe('remote');
    });
  });

  // ── deployment gate ──

  describe('deploymentGate', () => {
    it('skips when flag is unset', () => {
      const gate = deploymentGate('python-host');
      expect(gate.shouldRun).toBe(false);
      expect(gate.skipReason).toContain('RUN_DEPLOYMENT_TESTS not set');
    });

    it('throws when flag is set but tool not found', () => {
      process.env.RUN_DEPLOYMENT_TESTS = '1';
      process.env.DECISION_CORE_DISABLE_LOCAL_HOST_DISCOVERY = '1';
      // No PYTHON_AGENT_HOST_PATH and python-agent-host unlikely in PATH during tests
      expect(() => deploymentGate('python-host')).toThrow(/python-host not found/);
    });

    it('runs when flag is set and tool path provided', () => {
      process.env.RUN_DEPLOYMENT_TESTS = '1';
      process.env.PYTHON_AGENT_HOST_PATH = process.cwd();
      const gate = deploymentGate('python-host');
      expect(gate.shouldRun).toBe(true);
      expect(gate.skipReason).toBeNull();
    });

    it('runs when flag is set and typescript host path provided', () => {
      process.env.RUN_DEPLOYMENT_TESTS = '1';
      process.env.TYPESCRIPT_AGENT_HOST_PATH = process.cwd();
      const gate = deploymentGate('typescript-host');
      expect(gate.shouldRun).toBe(true);
      expect(gate.skipReason).toBeNull();
    });

    it('throws when an explicit tool path does not exist', () => {
      process.env.RUN_DEPLOYMENT_TESTS = '1';
      process.env.PYTHON_AGENT_HOST_PATH = '/definitely/not/a/real/python-host';
      expect(() => deploymentGate('python-host')).toThrow(/python-host not found/);
    });
  });

  // ── model eval gate ──

  describe('modelEvalGate', () => {
    it('skips when flag is unset', () => {
      const gate = modelEvalGate();
      expect(gate.shouldRun).toBe(false);
      expect(gate.skipReason).toContain('RUN_MODEL_EVALS not set');
    });

    it('throws when flag is set but no provider found', () => {
      process.env.RUN_MODEL_EVALS = '1';
      expect(() => modelEvalGate()).toThrow(/no model provider configured/);
    });

    it('runs when flag is set and provider configured', () => {
      process.env.RUN_MODEL_EVALS = '1';
      process.env.LOCAL_MODEL_PROVIDER = 'ollama';
      const gate = modelEvalGate();
      expect(gate.shouldRun).toBe(true);
      expect(gate.skipReason).toBeNull();
    });
  });
});
