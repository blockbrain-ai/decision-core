/**
 * Policy Pack Loader Tests
 *
 * Validates schema parsing, pack loading, and rule evaluation
 * for all bundled policy packs.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PolicyPackSchema, type PolicyPack } from '../contracts/policy-pack.contracts.js';
import {
  loadBundledPack,
  loadAllBundledPacks,
  loadPackAsRules,
  AVAILABLE_PACKS,
  getBundledPackPath,
} from './pack-loader.js';
import { existsSync } from 'fs';

describe('policy-pack schema validation', () => {
  it('validates a minimal valid pack', () => {
    const minimalPack = {
      name: 'test',
      version: '1.0.0',
      description: 'A test pack',
      profile: 'personal',
      rules: [
        {
          name: 'test-rule',
          action: 'allow',
        },
      ],
      surfaces: [
        {
          name: 'default',
          trustTier: 'standard',
        },
      ],
      trustTiers: [
        {
          name: 'standard',
          requiresApproval: false,
        },
      ],
    };

    const result = PolicyPackSchema.safeParse(minimalPack);
    expect(result.success).toBe(true);
  });

  it('rejects a pack with missing required fields', () => {
    const invalid = {
      name: 'test',
      // missing version, description, profile, rules, surfaces, trustTiers
    };

    const result = PolicyPackSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects a pack with invalid profile', () => {
    const invalid = {
      name: 'test',
      version: '1.0.0',
      description: 'Bad profile',
      profile: 'invalid_profile',
      rules: [{ name: 'r', action: 'allow' }],
      surfaces: [{ name: 's', trustTier: 't' }],
      trustTiers: [{ name: 't', requiresApproval: false }],
    };

    const result = PolicyPackSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects a pack with invalid rule action', () => {
    const invalid = {
      name: 'test',
      version: '1.0.0',
      description: 'Bad action',
      profile: 'personal',
      rules: [{ name: 'r', action: 'maybe' }],
      surfaces: [{ name: 's', trustTier: 't' }],
      trustTiers: [{ name: 't', requiresApproval: false }],
    };

    const result = PolicyPackSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects control characters in rule tool patterns', () => {
    const invalid = {
      name: 'test',
      version: '1.0.0',
      description: 'Bad tool pattern',
      profile: 'personal',
      rules: [{ name: 'r', action: 'allow', tools: ['read_*\nwrite_*'] }],
      surfaces: [{ name: 's', trustTier: 't' }],
      trustTiers: [{ name: 't', requiresApproval: false }],
    };

    const result = PolicyPackSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects a pack with empty rules array', () => {
    const invalid = {
      name: 'test',
      version: '1.0.0',
      description: 'No rules',
      profile: 'personal',
      rules: [],
      surfaces: [{ name: 's', trustTier: 't' }],
      trustTiers: [{ name: 't', requiresApproval: false }],
    };

    const result = PolicyPackSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('validates a pack with full conditions', () => {
    const fullPack = {
      name: 'full',
      version: '2.0.0',
      description: 'Full conditions test',
      profile: 'enterprise',
      rules: [
        {
          name: 'complex-rule',
          description: 'A rule with all conditions',
          action: 'approve_required',
          surfaces: ['finance'],
          tools: ['transfer_*'],
          conditions: {
            maxAmountUsd: 50000,
            minAmountUsd: 1000,
            maxCountPerDay: 100,
            cooldownMinutes: 15,
            timeWindowStart: '08:00',
            timeWindowEnd: '18:00',
            requireDualAuthorization: true,
            requireAuditTrail: true,
            crossTenantAccess: false,
          },
          priority: 50,
        },
      ],
      surfaces: [
        {
          name: 'finance',
          description: 'Financial operations',
          trustTier: 'critical',
          category: 'finance',
        },
      ],
      trustTiers: [
        {
          name: 'critical',
          description: 'Critical tier',
          requiresApproval: true,
          requiresAudit: true,
          riskLevel: 'critical',
        },
      ],
      exampleTools: ['transfer_funds'],
    };

    const result = PolicyPackSchema.safeParse(fullPack);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rules[0].conditions?.maxAmountUsd).toBe(50000);
      expect(result.data.rules[0].conditions?.requireDualAuthorization).toBe(true);
    }
  });
});

describe('policy-pack bundled pack loading', () => {
  it('all bundled pack files exist', () => {
    for (const name of AVAILABLE_PACKS) {
      const path = getBundledPackPath(name);
      expect(existsSync(path), `Pack file missing: ${path}`).toBe(true);
    }
  });

  describe('personal pack', () => {
    let pack: PolicyPack;

    beforeAll(() => {
      pack = loadBundledPack('personal');
    });

    it('loads without error', () => {
      expect(pack.name).toBe('personal');
      expect(pack.version).toBe('1.0.0');
      expect(pack.profile).toBe('personal');
    });

    it('allows read tools', () => {
      const readRule = pack.rules.find(r => r.name === 'allow-read-tools');
      expect(readRule).toBeDefined();
      expect(readRule!.action).toBe('allow');
      expect(readRule!.tools).toContain('read_*');
    });

    it('blocks destructive tools', () => {
      const denyRule = pack.rules.find(r => r.name === 'block-destructive');
      expect(denyRule).toBeDefined();
      expect(denyRule!.action).toBe('deny');
      expect(denyRule!.tools).toContain('delete_*');
      expect(denyRule!.tools).toContain('drop_*');
      expect(denyRule!.tools).toContain('rm_*');
    });

    it('has no approval requirements', () => {
      const approvalRules = pack.rules.filter(r => r.action === 'approve_required');
      expect(approvalRules).toHaveLength(0);
    });
  });

  describe('team pack', () => {
    let pack: PolicyPack;

    beforeAll(() => {
      pack = loadBundledPack('team');
    });

    it('loads without error', () => {
      expect(pack.name).toBe('team');
      expect(pack.profile).toBe('team');
    });

    it('requires approval for write operations on shared resources', () => {
      const sharedWriteRule = pack.rules.find(r => r.name === 'approve-shared-writes');
      expect(sharedWriteRule).toBeDefined();
      expect(sharedWriteRule!.action).toBe('approve_required');
      expect(sharedWriteRule!.surfaces).toContain('shared');
    });

    it('has multiple surfaces', () => {
      expect(pack.surfaces.length).toBeGreaterThanOrEqual(3);
      const surfaceNames = pack.surfaces.map(s => s.name);
      expect(surfaceNames).toContain('shared');
      expect(surfaceNames).toContain('personal');
      expect(surfaceNames).toContain('admin');
    });

    it('has multiple trust tiers', () => {
      expect(pack.trustTiers.length).toBeGreaterThanOrEqual(3);
      const tierNames = pack.trustTiers.map(t => t.name);
      expect(tierNames).toContain('standard');
      expect(tierNames).toContain('elevated');
      expect(tierNames).toContain('restricted');
    });
  });

  describe('fintech pack', () => {
    let pack: PolicyPack;

    beforeAll(() => {
      pack = loadBundledPack('fintech');
    });

    it('loads without error', () => {
      expect(pack.name).toBe('fintech');
      expect(pack.profile).toBe('enterprise');
    });

    it('includes amount thresholds', () => {
      const lowValue = pack.rules.find(r => r.name === 'auto-approve-low-value');
      expect(lowValue).toBeDefined();
      expect(lowValue!.conditions?.maxAmountUsd).toBe(1000);

      const medValue = pack.rules.find(r => r.name === 'approve-medium-value');
      expect(medValue).toBeDefined();
      expect(medValue!.conditions?.minAmountUsd).toBe(1000);
      expect(medValue!.conditions?.maxAmountUsd).toBe(50000);

      const highValue = pack.rules.find(r => r.name === 'deny-high-value');
      expect(highValue).toBeDefined();
      expect(highValue!.action).toBe('deny');
      expect(highValue!.conditions?.minAmountUsd).toBe(50000);
    });

    it('includes sanctions check requirement', () => {
      const sanctions = pack.rules.find(r => r.name === 'require-sanctions-check');
      expect(sanctions).toBeDefined();
      expect(sanctions!.action).toBe('approve_required');
      expect(sanctions!.tools).toContain('counterparty_*');
    });

    it('includes dual authorization for high-risk', () => {
      const dualAuth = pack.rules.find(r => r.name === 'dual-auth-high-risk');
      expect(dualAuth).toBeDefined();
      expect(dualAuth!.conditions?.requireDualAuthorization).toBe(true);
    });
  });

  describe('healthcare pack', () => {
    let pack: PolicyPack;

    beforeAll(() => {
      pack = loadBundledPack('healthcare');
    });

    it('loads without error', () => {
      expect(pack.name).toBe('healthcare');
      expect(pack.profile).toBe('enterprise');
    });

    it('includes patient data access controls', () => {
      const phiAccess = pack.rules.find(r => r.name === 'approve-phi-access');
      expect(phiAccess).toBeDefined();
      expect(phiAccess!.action).toBe('approve_required');
      expect(phiAccess!.surfaces).toContain('phi');
      expect(phiAccess!.conditions?.requireAuditTrail).toBe(true);
    });

    it('includes audit requirements', () => {
      const auditRule = pack.rules.find(r => r.name === 'audit-all-decisions');
      expect(auditRule).toBeDefined();
      expect(auditRule!.conditions?.requireAuditTrail).toBe(true);
    });

    it('blocks PHI export by default', () => {
      const exportDeny = pack.rules.find(r => r.name === 'deny-phi-export-default');
      expect(exportDeny).toBeDefined();
      expect(exportDeny!.action).toBe('deny');
    });

    it('requires dual authorization for authorized PHI export', () => {
      const exportAuth = pack.rules.find(r => r.name === 'approve-phi-export-authorized');
      expect(exportAuth).toBeDefined();
      expect(exportAuth!.conditions?.requireDualAuthorization).toBe(true);
    });
  });

  describe('saas pack', () => {
    let pack: PolicyPack;

    beforeAll(() => {
      pack = loadBundledPack('saas');
    });

    it('loads without error', () => {
      expect(pack.name).toBe('saas');
      expect(pack.profile).toBe('enterprise');
    });

    it('includes multi-tenant isolation rules', () => {
      const crossTenant = pack.rules.find(r => r.name === 'deny-cross-tenant');
      expect(crossTenant).toBeDefined();
      expect(crossTenant!.action).toBe('deny');
      expect(crossTenant!.conditions?.crossTenantAccess).toBe(false);
    });

    it('includes API rate limits', () => {
      const rateLimit = pack.rules.find(r => r.name === 'rate-limit-api');
      expect(rateLimit).toBeDefined();
      expect(rateLimit!.conditions?.maxCountPerDay).toBe(10000);
    });

    it('has tenant data surface', () => {
      const tenantSurface = pack.surfaces.find(s => s.name === 'tenant-data');
      expect(tenantSurface).toBeDefined();
      expect(tenantSurface!.trustTier).toBe('elevated');
    });

    it('includes billing controls', () => {
      const billing = pack.rules.find(r => r.name === 'approve-billing');
      expect(billing).toBeDefined();
      expect(billing!.action).toBe('approve_required');
      expect(billing!.conditions?.requireDualAuthorization).toBe(true);
    });
  });
});

describe('policy-pack loadAllBundledPacks', () => {
  it('loads all packs successfully', () => {
    const packs = loadAllBundledPacks();
    expect(packs.size).toBe(AVAILABLE_PACKS.length);

    for (const name of AVAILABLE_PACKS) {
      expect(packs.has(name)).toBe(true);
      const pack = packs.get(name)!;
      expect(pack.name).toBe(name);
    }
  });
});

describe('policy-pack rule semantics', () => {
  it('deny rules have higher priority than allow rules in fintech', () => {
    const pack = loadBundledPack('fintech');
    const denyRules = pack.rules.filter(r => r.action === 'deny');
    const allowRules = pack.rules.filter(r => r.action === 'allow');

    const maxAllowPriority = Math.max(...allowRules.map(r => r.priority));
    const minDenyPriority = Math.min(...denyRules.map(r => r.priority));

    expect(minDenyPriority).toBeGreaterThan(maxAllowPriority);
  });

  it('each pack has unique rule names', () => {
    for (const name of AVAILABLE_PACKS) {
      const pack = loadBundledPack(name);
      const ruleNames = pack.rules.map(r => r.name);
      const uniqueNames = new Set(ruleNames);
      expect(uniqueNames.size).toBe(ruleNames.length);
    }
  });

  it('each pack references only defined trust tiers in surfaces', () => {
    for (const name of AVAILABLE_PACKS) {
      const pack = loadBundledPack(name);
      const tierNames = new Set(pack.trustTiers.map(t => t.name));
      for (const surface of pack.surfaces) {
        expect(
          tierNames.has(surface.trustTier),
          `Pack ${name}: surface "${surface.name}" references undefined tier "${surface.trustTier}"`
        ).toBe(true);
      }
    }
  });
});

describe('loadPackAsRules', () => {
  const testDir = join(tmpdir(), `dc-pack-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  it('loads bundled contracts-format packs via auto-detection', () => {
    const packPath = getBundledPackPath('personal');
    const result = loadPackAsRules(packPath);
    expect(result.sourceFormat).toBe('contracts-pack');
    expect(result.packName).toBe('personal');
    expect(result.denyUnknownDefault).toBe(false);
    expect(result.rules.length).toBeGreaterThan(0);
  });

  it('loads SDK-format pack with denyUnknownDefault', () => {
    const sdkPack = `
version: "1.0.0"
name: "sdk-test"
denyUnknownDefault: true
rules:
  - name: "deny-delete"
    actionTypePattern: "delete_*"
    priority: 90
    requireApproval: false
    defaultVerdict: "deny"
  - name: "allow-read"
    actionTypePattern: "read_*"
    priority: 10
`;
    const filePath = join(testDir, 'sdk-pack.yaml');
    writeFileSync(filePath, sdkPack, 'utf-8');

    const result = loadPackAsRules(filePath);
    expect(result.sourceFormat).toBe('sdk-pack');
    expect(result.packName).toBe('sdk-test');
    expect(result.denyUnknownDefault).toBe(true);
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0].defaultVerdict).toBe('deny');
    expect(result.rules[1].defaultVerdict).toBeUndefined();
  });

  it('throws on non-existent file', () => {
    expect(() => loadPackAsRules('/nonexistent/pack.yaml')).toThrow('not found');
  });

  it('throws on invalid YAML', () => {
    const filePath = join(testDir, 'invalid.yaml');
    writeFileSync(filePath, 'not: [valid: pack', 'utf-8');
    expect(() => loadPackAsRules(filePath)).toThrow();
  });

  it('defaultVerdict survives contracts-pack conversion for deny rules', () => {
    const packPath = getBundledPackPath('personal');
    const result = loadPackAsRules(packPath);
    const denyRules = result.rules.filter(r => r.defaultVerdict === 'deny');
    expect(denyRules.length).toBeGreaterThan(0);
  });
});
