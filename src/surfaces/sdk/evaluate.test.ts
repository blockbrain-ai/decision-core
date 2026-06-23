import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { evaluate } from './evaluate.js';

describe('evaluate convenience function', () => {
  const testDir = join(tmpdir(), `dc-evaluate-test-${Date.now()}`);
  let packPath: string;

  beforeAll(() => {
    mkdirSync(join(testDir, '.decision-core'), { recursive: true });
    packPath = join(testDir, '.decision-core', 'policy-pack.yaml');
    writeFileSync(packPath, `
version: "1.0.0"
name: "evaluate-test"
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
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('allows known actions', async () => {
    const result = await evaluate(
      { action: 'read_file', surface: 'api' },
      { policyPackPath: packPath },
    );
    expect(result.decision).toBe('allow');
  });

  it('denies unknown actions with denyUnknownDefault', async () => {
    const result = await evaluate(
      { action: 'unknown_tool', surface: 'api' },
      { policyPackPath: packPath },
    );
    expect(result.decision).toBe('deny');
    expect(result.rationale).toContain('unknown actions denied');
  });

  it('denies actions matching deny rules', async () => {
    const result = await evaluate(
      { action: 'delete_database', surface: 'api' },
      { policyPackPath: packPath },
    );
    expect(result.decision).toBe('deny');
    expect(result.matchedPolicies.length).toBeGreaterThan(0);
  });

  it('defaults surface to "default"', async () => {
    const result = await evaluate(
      { action: 'read_file' },
      { policyPackPath: packPath },
    );
    expect(result.decision).toBe('allow');
  });

  it('returns structured matchedPolicies', async () => {
    const result = await evaluate(
      { action: 'read_file', surface: 'api' },
      { policyPackPath: packPath },
    );
    expect(result.matchedPolicies.length).toBeGreaterThan(0);
    expect(result.matchedPolicies[0]).toHaveProperty('ruleId');
    expect(result.matchedPolicies[0]).toHaveProperty('ruleName');
    expect(result.matchedPolicies[0]).toHaveProperty('verdict');
    expect(result.matchedPolicies[0]).toHaveProperty('reason');
  });

  it('does not force deny-unknown for packs that do not opt in', async () => {
    const permissivePack = join(testDir, '.decision-core', 'permissive-pack.yaml');
    writeFileSync(permissivePack, `
version: "1.0.0"
name: "permissive"
rules:
  - name: "allow-read"
    actionTypePattern: "read_*"
    priority: 50
`, 'utf-8');

    const result = await evaluate(
      { action: 'unknown_tool', surface: 'api' },
      { policyPackPath: permissivePack },
    );
    expect(result.decision).toBe('allow');
  });

  it('returns human-readable rationale', async () => {
    const result = await evaluate(
      { action: 'read_file', surface: 'api' },
      { policyPackPath: packPath },
    );
    expect(typeof result.rationale).toBe('string');
    expect(result.rationale.length).toBeGreaterThan(0);
  });
});
