import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPolicyGuard } from './create-policy-guard.js';
import { PolicyGuardConfigSchema } from './types.js';

describe('createPolicyGuard', () => {
  it('works with zero config', async () => {
    const guard = await createPolicyGuard();

    expect(guard).toBeDefined();
    expect(guard.evaluate).toBeTypeOf('function');
  });

  it('allows actions when no rules are loaded', async () => {
    const guard = await createPolicyGuard();

    const verdict = await guard.evaluate('tenant-1', 'surface.a', 'some.action');

    expect(verdict.verdict).toBe('allow');
    expect(verdict.matchedPolicies).toEqual([]);
  });

  it('loads policy pack and evaluates rules', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dc-guard-test-'));
    const packPath = join(tmpDir, 'rules.yaml');

    writeFileSync(packPath, `
version: "1.0.0"
name: "Guard Test Pack"
rules:
  - name: "Require approval for financial actions"
    description: "Requires approval for finance.* actions"
    actionTypePattern: "finance.*"
    riskClass: "A"
    enforcementPoint: "pre_decision"
    policyType: "compliance"
    priority: 90
    requireApproval: true
    enabled: true
    requiredConstraints: []
  - name: "Allow general actions"
    description: "Allows general.* actions"
    actionTypePattern: "general.*"
    riskClass: "C"
    enforcementPoint: "pre_decision"
    policyType: "business"
    priority: 10
    requireApproval: false
    enabled: true
    requiredConstraints: []
`);

    try {
      const guard = await createPolicyGuard({
        policyPackPath: packPath,
        tenantId: 'test-tenant',
      });

      // Action matching approval-required pattern
      const result = await guard.evaluate('test-tenant', 'surface.a', 'finance.transfer');
      expect(result.verdict).toBe('approve_required');
      expect(result.matchedPolicies.length).toBeGreaterThan(0);

      // Action not matching any rule
      const allowed = await guard.evaluate('test-tenant', 'surface.a', 'unknown.action');
      expect(allowed.verdict).toBe('allow');
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('evaluates with context parameters', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dc-guard-ctx-'));
    const packPath = join(tmpDir, 'rules.yaml');

    writeFileSync(packPath, `
version: "1.0.0"
rules:
  - name: "High value check"
    description: "Requires approval for high financial impact"
    actionTypePattern: "payment.*"
    riskClass: "A"
    enforcementPoint: "pre_decision"
    policyType: "compliance"
    priority: 80
    maxAmountUsd: 1000
    requireApproval: true
    enabled: true
    requiredConstraints: []
`);

    try {
      const guard = await createPolicyGuard({
        policyPackPath: packPath,
        tenantId: 'test-tenant',
      });

      const result = await guard.evaluate(
        'test-tenant',
        'surface.a',
        'payment.process',
        { financialImpact: 5000 },
      );

      // Rule matches because actionType matches the pattern
      expect(result.matchedPolicies.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('PolicyGuardConfigSchema', () => {
  it('applies defaults for empty config', () => {
    const result = PolicyGuardConfigSchema.parse({});
    expect(result.tenantId).toBe('default');
  });

  it('accepts custom config', () => {
    const result = PolicyGuardConfigSchema.parse({
      policyPackPath: '/path/to/pack.yaml',
      tenantId: 'custom-tenant',
    });
    expect(result.policyPackPath).toBe('/path/to/pack.yaml');
    expect(result.tenantId).toBe('custom-tenant');
  });
});
