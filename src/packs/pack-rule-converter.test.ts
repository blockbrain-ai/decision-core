import { describe, it, expect } from 'vitest';
import { contractsPackToRules, sdkPackToRules } from './pack-rule-converter.js';
import { PolicyPackSchema as ContractsPackSchema } from '../contracts/policy-pack.contracts.js';
import { PolicyPackSchema as SdkPackSchema } from '../surfaces/sdk/types.js';

function makeContractsPack(overrides: Record<string, unknown> = {}) {
  return ContractsPackSchema.parse({
    name: 'test', version: '1.0.0', description: 'test', profile: 'personal',
    rules: [{ name: 'r1', action: 'allow' }],
    surfaces: [{ name: 's', trustTier: 't' }],
    trustTiers: [{ name: 't', requiresApproval: false }],
    ...overrides,
  });
}

describe('contractsPackToRules', () => {
  it('converts allow action to no defaultVerdict', () => {
    const pack = makeContractsPack({
      rules: [{ name: 'r1', action: 'allow', priority: 10 }],
    });
    const rules = contractsPackToRules(pack);
    expect(rules).toHaveLength(1);
    expect(rules[0].requireApproval).toBe(false);
    expect(rules[0].defaultVerdict).toBeUndefined();
  });

  it('converts deny action to defaultVerdict deny', () => {
    const pack = makeContractsPack({
      rules: [{ name: 'r1', action: 'deny', priority: 50 }],
    });
    const rules = contractsPackToRules(pack);
    expect(rules[0].defaultVerdict).toBe('deny');
    expect(rules[0].requireApproval).toBe(false);
  });

  it('converts approve_required action', () => {
    const pack = makeContractsPack({
      profile: 'team',
      rules: [{ name: 'r1', action: 'approve_required', priority: 50 }],
      trustTiers: [{ name: 't', requiresApproval: true }],
    });
    const rules = contractsPackToRules(pack);
    expect(rules[0].requireApproval).toBe(true);
    expect(rules[0].defaultVerdict).toBe('approve_required');
  });

  it('expands tools array into one rule per tool', () => {
    const pack = makeContractsPack({
      rules: [{ name: 'r1', action: 'allow', tools: ['read_*', 'list_*'], priority: 10 }],
    });
    const rules = contractsPackToRules(pack);
    expect(rules).toHaveLength(2);
    expect(rules[0].actionTypePattern).toBe('read_*');
    expect(rules[1].actionTypePattern).toBe('list_*');
  });

  it('uses wildcard when no tools specified', () => {
    const pack = makeContractsPack();
    const rules = contractsPackToRules(pack);
    expect(rules[0].actionTypePattern).toBe('*');
  });

  it('passes through conditions', () => {
    const pack = makeContractsPack({
      profile: 'enterprise',
      rules: [{
        name: 'r1', action: 'approve_required', priority: 50,
        conditions: { maxAmountUsd: 5000, cooldownMinutes: 10, timeWindowStart: '09:00', timeWindowEnd: '17:00' },
      }],
    });
    const rules = contractsPackToRules(pack);
    expect(rules[0].maxAmountUsd).toBe(5000);
    expect(rules[0].cooldownMinutes).toBe(10);
    expect(rules[0].timeWindowStart).toBe('09:00');
    expect(rules[0].timeWindowEnd).toBe('17:00');
  });
});

describe('sdkPackToRules', () => {
  it('passes through defaultVerdict from SDK format', () => {
    const pack = SdkPackSchema.parse({
      version: '1.0.0',
      denyUnknownDefault: true,
      rules: [{
        name: 'deny-delete',
        actionTypePattern: 'delete_*',
        priority: 90,
        requireApproval: false,
        defaultVerdict: 'deny',
      }],
    });
    const rules = sdkPackToRules(pack);
    expect(rules).toHaveLength(1);
    expect(rules[0].defaultVerdict).toBe('deny');
    expect(rules[0].actionTypePattern).toBe('delete_*');
  });

  it('handles rules without defaultVerdict', () => {
    const pack = SdkPackSchema.parse({
      version: '1.0.0',
      rules: [{
        name: 'allow-read',
        actionTypePattern: 'read_*',
      }],
    });
    const rules = sdkPackToRules(pack);
    expect(rules[0].defaultVerdict).toBeUndefined();
  });
});
