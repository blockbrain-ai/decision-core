import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPolicyPack, parsePolicyPackYaml, policyPackToRules } from './policy-pack-loader.js';

describe('parsePolicyPackYaml', () => {
  it('parses valid YAML policy pack', () => {
    const yaml = `
version: "1.0.0"
name: "Test Pack"
description: "A test policy pack"
rules:
  - name: "Rule 1"
    description: "First rule"
    actionTypePattern: "action.*"
    riskClass: "B"
    enforcementPoint: "pre_decision"
    policyType: "business"
    priority: 50
    requireApproval: false
    enabled: true
    requiredConstraints: []
  - name: "Rule 2"
    description: "Second rule"
    actionTypePattern: "other.*"
    riskClass: "A"
    enforcementPoint: "action_dispatch"
    policyType: "safety"
    priority: 90
    requireApproval: true
    enabled: true
    requiredConstraints:
      - "human_review"
`;

    const pack = parsePolicyPackYaml(yaml);

    expect(pack.version).toBe('1.0.0');
    expect(pack.name).toBe('Test Pack');
    expect(pack.rules).toHaveLength(2);
    expect(pack.rules[0].name).toBe('Rule 1');
    expect(pack.rules[0].riskClass).toBe('B');
    expect(pack.rules[1].requireApproval).toBe(true);
    expect(pack.rules[1].requiredConstraints).toEqual(['human_review']);
  });

  it('applies defaults for optional fields', () => {
    const yaml = `
rules:
  - name: "Minimal Rule"
    actionTypePattern: "minimal.*"
`;

    const pack = parsePolicyPackYaml(yaml);

    expect(pack.version).toBe('1.0.0');
    expect(pack.rules[0].riskClass).toBe('B');
    expect(pack.rules[0].enforcementPoint).toBe('pre_decision');
    expect(pack.rules[0].policyType).toBe('business');
    expect(pack.rules[0].priority).toBe(50);
    expect(pack.rules[0].requireApproval).toBe(false);
    expect(pack.rules[0].enabled).toBe(true);
    expect(pack.rules[0].requiredConstraints).toEqual([]);
  });

  it('rejects invalid YAML', () => {
    expect(() => parsePolicyPackYaml('rules: "not an array"')).toThrow();
  });

  it('rejects missing required fields', () => {
    const yaml = `
rules:
  - description: "Missing name and pattern"
`;
    expect(() => parsePolicyPackYaml(yaml)).toThrow();
  });

  it('rejects control characters in action type patterns', () => {
    const yaml = `
rules:
  - name: "Bad Rule"
    actionTypePattern: |-
      delete_*
      safe_read
`;
    expect(() => parsePolicyPackYaml(yaml)).toThrow();
  });
});

describe('policyPackToRules', () => {
  it('converts pack rules to PolicyRuleCreateInput objects', () => {
    const yaml = `
rules:
  - name: "Test Rule"
    actionTypePattern: "test.*"
    riskClass: "C"
    priority: 30
`;

    const pack = parsePolicyPackYaml(yaml);
    const inputs = policyPackToRules(pack);

    expect(inputs).toHaveLength(1);
    expect(inputs[0].name).toBe('Test Rule');
    expect(inputs[0].actionTypePattern).toBe('test.*');
    expect(inputs[0].riskClass).toBe('C');
    expect(inputs[0].priority).toBe(30);
  });
});

describe('loadPolicyPack', () => {
  it('loads from a file path', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dc-pack-load-'));
    const filePath = join(tmpDir, 'pack.yaml');

    writeFileSync(filePath, `
version: "2.0.0"
name: "File Pack"
rules:
  - name: "File Rule"
    actionTypePattern: "file.*"
`);

    try {
      const pack = loadPolicyPack(filePath);
      expect(pack.version).toBe('2.0.0');
      expect(pack.name).toBe('File Pack');
      expect(pack.rules[0].name).toBe('File Rule');
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('throws for non-existent file', () => {
    expect(() => loadPolicyPack('/nonexistent/path.yaml')).toThrow();
  });
});
