import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createPolicyGuard } from './create-policy-guard.js';

describe('denyUnknownDefault via createPolicyGuard', () => {
  const testDir = join(tmpdir(), `dc-deny-unknown-test-${Date.now()}`);
  let packPath: string;

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    packPath = join(testDir, 'pack.yaml');
    writeFileSync(packPath, `
version: "1.0.0"
name: "deny-unknown-test"
denyUnknownDefault: true
rules:
  - name: "allow-read"
    actionTypePattern: "read_*"
    priority: 50
    requireApproval: false
`, 'utf-8');
  });

  it('allows known actions that match a rule', async () => {
    const guard = await createPolicyGuard({ policyPackPath: packPath });
    const result = await guard.evaluate('default', 'api', 'read_file');
    expect(result.verdict).toBe('allow');
  });

  it('denies unknown actions when denyUnknownDefault is true', async () => {
    const guard = await createPolicyGuard({ policyPackPath: packPath });
    const result = await guard.evaluate('default', 'api', 'unknown_tool');
    expect(result.verdict).toBe('deny');
    expect(result.matchedPolicies[0].ruleName).toBe('deny-unknown-default');
  });

  it('allows unknown actions when denyUnknownDefault is false', async () => {
    const permissivePath = join(testDir, 'permissive.yaml');
    writeFileSync(permissivePath, `
version: "1.0.0"
name: "permissive-test"
denyUnknownDefault: false
rules:
  - name: "allow-read"
    actionTypePattern: "read_*"
    priority: 50
`, 'utf-8');

    const guard = await createPolicyGuard({ policyPackPath: permissivePath });
    const result = await guard.evaluate('default', 'api', 'unknown_tool');
    expect(result.verdict).toBe('allow');
  });

  it('config-level denyUnknownDefault overrides pack default', async () => {
    const permissivePath = join(testDir, 'permissive2.yaml');
    writeFileSync(permissivePath, `
version: "1.0.0"
name: "permissive-pack"
denyUnknownDefault: false
rules:
  - name: "allow-read"
    actionTypePattern: "read_*"
    priority: 50
`, 'utf-8');

    const guard = await createPolicyGuard({ policyPackPath: permissivePath, denyUnknownDefault: true });
    const result = await guard.evaluate('default', 'api', 'unknown_tool');
    expect(result.verdict).toBe('deny');
  });

  it('deny rules with defaultVerdict survive pack loading', async () => {
    const denyPackPath = join(testDir, 'deny-pack.yaml');
    writeFileSync(denyPackPath, `
version: "1.0.0"
name: "deny-test"
denyUnknownDefault: true
rules:
  - name: "allow-read"
    actionTypePattern: "read_*"
    priority: 50
  - name: "deny-delete"
    actionTypePattern: "delete_*"
    priority: 90
    defaultVerdict: "deny"
`, 'utf-8');

    const guard = await createPolicyGuard({ policyPackPath: denyPackPath });

    const readResult = await guard.evaluate('default', 'api', 'read_file');
    expect(readResult.verdict).toBe('allow');

    const deleteResult = await guard.evaluate('default', 'api', 'delete_database');
    expect(deleteResult.verdict).toBe('deny');
  });
});
