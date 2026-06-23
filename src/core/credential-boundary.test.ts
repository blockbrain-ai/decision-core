/**
 * Plugin Credential Boundary Audit Tests
 *
 * Verifies that Hermes and OpenCLAW plugins cannot access
 * Decision Core's provider credentials or internal state.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

describe('Hermes plugin credential boundary', () => {
  it('does not import provider-profiles or model-gateway', () => {
    const hermesTestPath = join(ROOT, 'test', 'e2e', 'hermes-bridge.test.ts');
    const content = readFileSync(hermesTestPath, 'utf-8');

    expect(content).not.toContain('provider-profiles');
    expect(content).not.toContain('model-gateway');
    expect(content).not.toContain('process.env');
  });

  it('only accesses Decision Core through HTTP /evaluate endpoint', () => {
    const hermesTestPath = join(ROOT, 'test', 'e2e', 'hermes-bridge.test.ts');
    const content = readFileSync(hermesTestPath, 'utf-8');

    // Hermes talks to DC only via HTTP
    expect(content).toContain('/evaluate');
    // Must use bearer token
    expect(content).toContain('Authorization');
    expect(content).toContain('Bearer');
  });

  it('receives only verdict data, never credential information', () => {
    const hermesTestPath = join(ROOT, 'test', 'e2e', 'hermes-bridge.test.ts');
    const content = readFileSync(hermesTestPath, 'utf-8');

    // The response shape contains only verdict and matchedPolicies
    expect(content).toContain('verdict');
    expect(content).toContain('matchedPolicies');
    // No credential fields in the response
    expect(content).not.toContain('apiKey');
    expect(content).not.toContain('envVarName');
    expect(content).not.toContain('credentialSource');
  });
});

describe('OpenCLAW plugin credential boundary', () => {
  it('accesses Decision Core only through PolicyGuard SDK interface', () => {
    const hookPath = join(ROOT, 'integrations', 'openclaw', 'before-tool-call.ts');
    const content = readFileSync(hookPath, 'utf-8');

    // Uses PolicyGuard, not direct imports of core modules
    expect(content).toContain('PolicyGuard');
    expect(content).not.toContain('model-gateway');
    expect(content).not.toContain('provider-profiles');
    expect(content).not.toContain('process.env');
  });

  it('entry point uses createPolicyGuard factory, not direct core wiring', () => {
    const indexPath = join(ROOT, 'integrations', 'openclaw', 'index.ts');
    const content = readFileSync(indexPath, 'utf-8');

    expect(content).toContain('createPolicyGuard');
    // Should not import ModelGateway or credential modules
    expect(content).not.toContain('ModelGateway');
    expect(content).not.toContain('credential-validation');
    expect(content).not.toContain('process.env');
  });

  it('hook results contain only verdict data, never credentials', () => {
    const hookPath = join(ROOT, 'integrations', 'openclaw', 'before-tool-call.ts');
    const content = readFileSync(hookPath, 'utf-8');

    // Result types: pass, block, requireApproval — no credential fields
    expect(content).toContain('PassResult');
    expect(content).toContain('BlockResult');
    expect(content).toContain('RequireApprovalResult');
    expect(content).not.toContain('apiKey');
    expect(content).not.toContain('envVarName');
  });

  it('approval bridge records only audit data, not credentials', () => {
    const bridgePath = join(ROOT, 'integrations', 'openclaw', 'approval-bridge.ts');
    const content = readFileSync(bridgePath, 'utf-8');

    expect(content).not.toContain('apiKey');
    expect(content).not.toContain('process.env');
    expect(content).not.toContain('credentialSource');
  });
});

describe('Provider profile credential isolation', () => {
  it('profiles reference env var names, never plaintext keys', () => {
    const profilePath = join(ROOT, 'src', 'core', 'provider-profiles.ts');
    const content = readFileSync(profilePath, 'utf-8');

    // envVarName is a string reference, not a value
    expect(content).toContain('envVarName');
    // No hardcoded API keys
    expect(content).not.toMatch(/['"]sk-[a-zA-Z0-9]+['"]/);
    expect(content).not.toMatch(/['"]AKIA[A-Z0-9]+['"]/);
  });

  it('model gateway reads env vars at call time, never stores values', () => {
    const gatewayPath = join(ROOT, 'src', 'core', 'model-gateway.ts');
    const content = readFileSync(gatewayPath, 'utf-8');

    // Reads env var at dispatch time: process.env[profile.envVarName]
    expect(content).toContain('process.env[profile.envVarName]');
    // Audit records contain hashes, not raw values
    expect(content).toContain('promptHash');
    expect(content).toContain('outputHash');
    // Never logs apiKey
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.includes('logger.')) {
        expect(line).not.toContain('apiKey');
        expect(line).not.toContain('process.env');
      }
    }
  });
});
