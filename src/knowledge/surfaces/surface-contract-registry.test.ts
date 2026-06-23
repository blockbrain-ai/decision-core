import { describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import { SurfaceContractRegistry } from './surface-contract-registry.service.js';
import type { SurfaceContract } from './surface-contract.types.js';

const FINANCE_SURFACE: SurfaceContract = {
  surfaceId: 'finance.processing',
  displayName: 'Finance Processing',
  category: 'finance',
  validDecisions: ['allow', 'deny', 'approve_required', 'escalate'],
  inputFields: [
    { name: 'amount', type: 'number', required: true, protectedAttribute: false },
    { name: 'currency', type: 'string', required: true, protectedAttribute: false },
    { name: 'recipient.country', type: 'string', required: false, protectedAttribute: false },
    { name: 'customer.ethnicity', type: 'string', required: false, protectedAttribute: true },
  ],
  forbiddenOutputs: ['auto_approve_high_risk'],
  safeFallback: 'deny',
  maxAutonomyTier: 2,
  protectedAttributeHazard: true,
  riskTier: 'critical',
};

const LOW_RISK_SURFACE: SurfaceContract = {
  surfaceId: 'data.extraction',
  displayName: 'Data Extraction',
  category: 'data',
  validDecisions: ['allow', 'deny'],
  inputFields: [
    { name: 'source', type: 'string', required: true, protectedAttribute: false },
    { name: 'format', type: 'enum', enumValues: ['csv', 'json', 'xml'], required: false, protectedAttribute: false },
  ],
  forbiddenOutputs: [],
  safeFallback: 'deny',
  maxAutonomyTier: 5,
  protectedAttributeHazard: false,
  riskTier: 'low',
};

describe('SurfaceContractRegistry', () => {
  let registry: SurfaceContractRegistry;

  beforeEach(() => {
    registry = new SurfaceContractRegistry();
  });

  describe('register and get', () => {
    it('registers and retrieves a surface contract', () => {
      registry.register(FINANCE_SURFACE);
      const result = registry.get('finance.processing');
      expect(result).toBeDefined();
      expect(result!.surfaceId).toBe('finance.processing');
      expect(result!.validDecisions).toEqual(['allow', 'deny', 'approve_required', 'escalate']);
    });

    it('returns undefined for unknown surface', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('reports has correctly', () => {
      registry.register(FINANCE_SURFACE);
      expect(registry.has('finance.processing')).toBe(true);
      expect(registry.has('nonexistent')).toBe(false);
    });

    it('registers multiple contracts with registerAll', () => {
      registry.registerAll([FINANCE_SURFACE, LOW_RISK_SURFACE]);
      expect(registry.size()).toBe(2);
      expect(registry.getAllSurfaceIds()).toContain('finance.processing');
      expect(registry.getAllSurfaceIds()).toContain('data.extraction');
    });

    it('overwrites existing contract on re-register', () => {
      registry.register(FINANCE_SURFACE);
      const updated = { ...FINANCE_SURFACE, maxAutonomyTier: 0 } as SurfaceContract;
      registry.register(updated);
      expect(registry.get('finance.processing')!.maxAutonomyTier).toBe(0);
    });

    it('rejects contract with empty surfaceId', () => {
      expect(() => registry.register({ ...FINANCE_SURFACE, surfaceId: '' })).toThrow();
    });

    it('rejects contract with empty validDecisions', () => {
      expect(() => registry.register({ ...FINANCE_SURFACE, validDecisions: [] })).toThrow();
    });
  });

  describe('isValidDecision', () => {
    it('returns true for valid decision', () => {
      registry.register(FINANCE_SURFACE);
      expect(registry.isValidDecision('finance.processing', 'deny')).toBe(true);
    });

    it('returns false for invalid decision', () => {
      registry.register(FINANCE_SURFACE);
      expect(registry.isValidDecision('finance.processing', 'auto_approve')).toBe(false);
    });

    it('returns true for unknown surface (permissive)', () => {
      expect(registry.isValidDecision('nonexistent', 'anything')).toBe(true);
    });
  });

  describe('isValidField', () => {
    it('returns true for known field', () => {
      registry.register(FINANCE_SURFACE);
      expect(registry.isValidField('finance.processing', 'amount')).toBe(true);
    });

    it('returns true for dot-notation field', () => {
      registry.register(FINANCE_SURFACE);
      expect(registry.isValidField('finance.processing', 'recipient.country')).toBe(true);
    });

    it('returns false for unknown field', () => {
      registry.register(FINANCE_SURFACE);
      expect(registry.isValidField('finance.processing', 'nonexistent_field')).toBe(false);
    });

    it('returns true for unknown surface (permissive)', () => {
      expect(registry.isValidField('nonexistent', 'anything')).toBe(true);
    });

    it('returns true when surface has no inputFields defined', () => {
      registry.register({
        surfaceId: 'minimal',
        validDecisions: ['allow', 'deny'],
        inputFields: [],
        forbiddenOutputs: [],
        safeFallback: 'deny',
        maxAutonomyTier: 3,
        protectedAttributeHazard: false,
      });
      expect(registry.isValidField('minimal', 'any_field')).toBe(true);
    });
  });

  describe('getFieldType', () => {
    it('returns type for known field', () => {
      registry.register(FINANCE_SURFACE);
      expect(registry.getFieldType('finance.processing', 'amount')).toBe('number');
      expect(registry.getFieldType('finance.processing', 'currency')).toBe('string');
    });

    it('returns undefined for unknown field', () => {
      registry.register(FINANCE_SURFACE);
      expect(registry.getFieldType('finance.processing', 'nope')).toBeUndefined();
    });

    it('returns undefined for unknown surface', () => {
      expect(registry.getFieldType('nope', 'amount')).toBeUndefined();
    });
  });

  describe('getProtectedFields', () => {
    it('returns protected-attribute fields', () => {
      registry.register(FINANCE_SURFACE);
      const fields = registry.getProtectedFields('finance.processing');
      expect(fields).toHaveLength(1);
      expect(fields[0].name).toBe('customer.ethnicity');
    });

    it('returns empty for surface without protected fields', () => {
      registry.register(LOW_RISK_SURFACE);
      expect(registry.getProtectedFields('data.extraction')).toHaveLength(0);
    });

    it('returns empty for unknown surface', () => {
      expect(registry.getProtectedFields('nonexistent')).toHaveLength(0);
    });
  });

  describe('isForbiddenOutput', () => {
    it('returns true for forbidden output', () => {
      registry.register(FINANCE_SURFACE);
      expect(registry.isForbiddenOutput('finance.processing', 'auto_approve_high_risk')).toBe(true);
    });

    it('returns false for allowed output', () => {
      registry.register(FINANCE_SURFACE);
      expect(registry.isForbiddenOutput('finance.processing', 'deny')).toBe(false);
    });

    it('returns false for unknown surface', () => {
      expect(registry.isForbiddenOutput('nonexistent', 'anything')).toBe(false);
    });
  });

  describe('loadFromFile', () => {
    it('loads YAML surface contract file', () => {
      const configPath = resolve(process.cwd(), 'config/surface-contracts/default.yaml');
      registry.loadFromFile(configPath);
      expect(registry.size()).toBeGreaterThan(0);
      expect(registry.has('finance.processing')).toBe(true);
    });
  });

  describe('mergeFromTrustRegistry', () => {
    it('adds surfaces not already in the registry', () => {
      registry.register(FINANCE_SURFACE);
      registry.mergeFromTrustRegistry({
        version: '1.0.0',
        surfaces: [
          { surfaceId: 'finance.processing', category: 'finance', description: 'Existing', riskTier: 'critical' },
          { surfaceId: 'new.surface', category: 'other', description: 'New one', riskTier: 'low' },
        ],
      });
      expect(registry.size()).toBe(2);
      expect(registry.get('finance.processing')!.maxAutonomyTier).toBe(2);
      expect(registry.get('new.surface')!.maxAutonomyTier).toBe(5);
    });

    it('maps critical risk tier to low autonomy', () => {
      registry.mergeFromTrustRegistry({
        version: '1.0.0',
        surfaces: [
          { surfaceId: 'critical.surface', category: 'x', description: 'x', riskTier: 'critical' },
        ],
      });
      expect(registry.get('critical.surface')!.maxAutonomyTier).toBe(1);
    });

    it('maps intermediate risk tier to medium autonomy', () => {
      registry.mergeFromTrustRegistry({
        version: '1.0.0',
        surfaces: [
          { surfaceId: 'mid.surface', category: 'x', description: 'x', riskTier: 'intermediate' },
        ],
      });
      expect(registry.get('mid.surface')!.maxAutonomyTier).toBe(3);
    });
  });

  describe('defaults', () => {
    it('applies defaults for optional fields', () => {
      registry.register({
        surfaceId: 'minimal',
        validDecisions: ['allow'],
      } as SurfaceContract);
      const contract = registry.get('minimal')!;
      expect(contract.inputFields).toEqual([]);
      expect(contract.forbiddenOutputs).toEqual([]);
      expect(contract.safeFallback).toBe('deny');
      expect(contract.maxAutonomyTier).toBe(3);
      expect(contract.protectedAttributeHazard).toBe(false);
    });
  });
});
