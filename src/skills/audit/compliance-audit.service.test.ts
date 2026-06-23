/**
 * Compliance Audit Service Tests
 *
 * Covers all gap detection categories, severity classification,
 * evidence integrity, tenant isolation, and report generation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { DecisionRecord } from '../../contracts/decision.contracts.js';
import type { TrustPolicyEntry, SurfaceBinding } from '../../trust/trust.contracts.js';
import { InMemoryDecisionLogRepository } from '../../persistence/memory/in-memory-decision-log.repository.js';
import { InMemoryPolicyRuleRepository } from '../../persistence/memory/in-memory-policy-rule.repository.js';
import { EvidenceChainService } from '../../integrity/evidence-chain.service.js';
import { ComplianceAuditService, formatReportAsMarkdown } from './compliance-audit.service.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';

// ===========================================================================
// Helpers
// ===========================================================================

const TENANT_A = 'tenant-a' as TenantId;
const TENANT_B = 'tenant-b' as TenantId;

function makeDecision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  const now = new Date().toISOString();
  return {
    id: generateUuidV7(),
    surface: 'test-surface',
    toolName: 'test.tool',
    status: 'generated',
    confidence: 0.9,
    latency: 50,
    input: {},
    output: {},
    correlationId: generateUuidV7(),
    tenantId: TENANT_A,
    auditHash: 'hash-' + generateUuidV7(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('ComplianceAuditService', () => {
  let decisionLogRepo: InMemoryDecisionLogRepository;
  let policyRuleRepo: InMemoryPolicyRuleRepository;
  let evidenceChainService: EvidenceChainService;
  let trustPolicies: Map<string, TrustPolicyEntry>;
  let surfaceBindings: Map<string, SurfaceBinding>;
  let service: ComplianceAuditService;

  beforeEach(() => {
    decisionLogRepo = new InMemoryDecisionLogRepository();
    policyRuleRepo = new InMemoryPolicyRuleRepository();
    evidenceChainService = new EvidenceChainService();
    trustPolicies = new Map();
    surfaceBindings = new Map();

    service = new ComplianceAuditService({
      decisionLogRepo,
      policyRuleRepo,
      evidenceChainService,
      getTrustPolicy: (id) => trustPolicies.get(id) ?? null,
      getSurfaceBinding: (id) => surfaceBindings.get(id) ?? null,
    });
  });

  // =========================================================================
  // Basic audit
  // =========================================================================

  it('should return clean report when no decisions exist', async () => {
    const report = await service.runAudit({ tenantId: TENANT_A });

    expect(report.tenantId).toBe(TENANT_A);
    expect(report.summary.totalDecisions).toBe(0);
    expect(report.summary.policyCoverage).toBe(100);
    expect(report.summary.evidenceIntegrity).toBe(100);
    expect(report.gaps).toHaveLength(0);
    expect(report.recommendations).toContain('No compliance gaps detected. Continue monitoring with periodic audits.');
  });

  it('should return clean report when all decisions are covered', async () => {
    // Create a decision
    await decisionLogRepo.append(TENANT_A, makeDecision({ toolName: 'test.action' }));

    // Create a matching rule
    await policyRuleRepo.create(TENANT_A, {
      name: 'Cover test',
      description: 'Covers test actions',
      actionTypePattern: 'test.*',
      riskClass: 'C',
      enforcementPoint: 'post_execution',
      policyType: 'business',
      priority: 100,
      requireApproval: false,
      enabled: true,
    });

    // Add trust policy and binding for the surface
    trustPolicies.set('test-surface', {
      surfaceId: 'test-surface',
      riskTier: 'low',
      modelPolicy: 'default',
      reviewMode: 'none',
    });
    surfaceBindings.set('test-surface', {
      surfaceId: 'test-surface',
      pattern: 'single_model',
      roles: { primary: { modelPolicy: 'default' } },
      fallbackStrategy: 'safe_block',
    });

    const report = await service.runAudit({ tenantId: TENANT_A });

    expect(report.summary.totalDecisions).toBe(1);
    expect(report.summary.policyCoverage).toBe(100);
    expect(report.gaps).toHaveLength(0);
  });

  // =========================================================================
  // Missing policy gaps
  // =========================================================================

  describe('missing_policy gap detection', () => {
    it('should detect tools with no matching enabled policy rules', async () => {
      await decisionLogRepo.append(TENANT_A, makeDecision({ toolName: 'email.send' }));

      // Add trust policy so we only trigger missing_policy, not missing_trust_tier
      trustPolicies.set('test-surface', {
        surfaceId: 'test-surface', riskTier: 'low', modelPolicy: 'default', reviewMode: 'none',
      });
      surfaceBindings.set('test-surface', {
        surfaceId: 'test-surface', pattern: 'single_model', roles: { primary: { modelPolicy: 'default' } }, fallbackStrategy: 'safe_block',
      });

      const report = await service.runAudit({ tenantId: TENANT_A });

      const policyGaps = report.gaps.filter((g) => g.category === 'missing_policy');
      expect(policyGaps.length).toBeGreaterThanOrEqual(1);
      expect(policyGaps[0].description).toContain('email.send');
    });

    it('should classify sensitive tools as critical severity', async () => {
      await decisionLogRepo.append(TENANT_A, makeDecision({ toolName: 'db.drop' }));

      trustPolicies.set('test-surface', {
        surfaceId: 'test-surface', riskTier: 'low', modelPolicy: 'default', reviewMode: 'none',
      });
      surfaceBindings.set('test-surface', {
        surfaceId: 'test-surface', pattern: 'single_model', roles: { primary: { modelPolicy: 'default' } }, fallbackStrategy: 'safe_block',
      });

      const report = await service.runAudit({ tenantId: TENANT_A });

      const policyGaps = report.gaps.filter((g) => g.category === 'missing_policy');
      expect(policyGaps.some((g) => g.severity === 'critical')).toBe(true);
    });
  });

  // =========================================================================
  // Missing trust tier gaps
  // =========================================================================

  describe('missing_trust_tier gap detection', () => {
    it('should detect surfaces without trust tier assignments', async () => {
      await decisionLogRepo.append(TENANT_A, makeDecision({ surface: 'unregistered-surface' }));

      // Create a matching policy rule so we isolate the trust tier gap
      await policyRuleRepo.create(TENANT_A, {
        name: 'Cover test', description: 'Covers test', actionTypePattern: 'test.*',
        riskClass: 'C', enforcementPoint: 'post_execution', policyType: 'business',
        priority: 100, requireApproval: false, enabled: true,
      });

      const report = await service.runAudit({ tenantId: TENANT_A });

      const trustGaps = report.gaps.filter((g) => g.category === 'missing_trust_tier');
      expect(trustGaps.length).toBeGreaterThanOrEqual(1);
      expect(trustGaps[0].severity).toBe('critical');
      expect(trustGaps[0].affectedSurfaces).toContain('unregistered-surface');
    });

    it('should detect surfaces with trust policy but no binding', async () => {
      await decisionLogRepo.append(TENANT_A, makeDecision({ surface: 'partial-surface' }));

      // Add trust policy but no binding
      trustPolicies.set('partial-surface', {
        surfaceId: 'partial-surface', riskTier: 'intermediate', modelPolicy: 'default', reviewMode: 'borderline',
      });

      // Create matching rule
      await policyRuleRepo.create(TENANT_A, {
        name: 'Cover test', description: 'Covers test', actionTypePattern: 'test.*',
        riskClass: 'C', enforcementPoint: 'post_execution', policyType: 'business',
        priority: 100, requireApproval: false, enabled: true,
      });

      const report = await service.runAudit({ tenantId: TENANT_A });

      const bindingGaps = report.gaps.filter(
        (g) => g.category === 'missing_trust_tier' && g.description.includes('surface binding'),
      );
      expect(bindingGaps.length).toBeGreaterThanOrEqual(1);
      expect(bindingGaps[0].severity).toBe('warning');
    });
  });

  // =========================================================================
  // Low confidence gaps
  // =========================================================================

  describe('low_confidence gap detection', () => {
    it('should flag low-confidence auto-approvals', async () => {
      await decisionLogRepo.append(TENANT_A, makeDecision({
        confidence: 0.3,
        status: 'generated',
        surface: 'risky-surface',
      }));

      // Add policy and trust
      await policyRuleRepo.create(TENANT_A, {
        name: 'Cover test', description: '', actionTypePattern: 'test.*',
        riskClass: 'C', enforcementPoint: 'post_execution', policyType: 'business',
        priority: 100, requireApproval: false, enabled: true,
      });
      trustPolicies.set('risky-surface', {
        surfaceId: 'risky-surface', riskTier: 'low', modelPolicy: 'default', reviewMode: 'none',
      });
      surfaceBindings.set('risky-surface', {
        surfaceId: 'risky-surface', pattern: 'single_model', roles: { primary: { modelPolicy: 'default' } }, fallbackStrategy: 'safe_block',
      });

      const report = await service.runAudit({ tenantId: TENANT_A });

      const confidenceGaps = report.gaps.filter((g) => g.category === 'low_confidence');
      expect(confidenceGaps.length).toBe(1);
      expect(confidenceGaps[0].affectedSurfaces).toContain('risky-surface');
    });

    it('should classify very low confidence as critical', async () => {
      await decisionLogRepo.append(TENANT_A, makeDecision({
        confidence: 0.2,
        status: 'generated',
      }));

      trustPolicies.set('test-surface', {
        surfaceId: 'test-surface', riskTier: 'low', modelPolicy: 'default', reviewMode: 'none',
      });
      surfaceBindings.set('test-surface', {
        surfaceId: 'test-surface', pattern: 'single_model', roles: { primary: { modelPolicy: 'default' } }, fallbackStrategy: 'safe_block',
      });
      await policyRuleRepo.create(TENANT_A, {
        name: 'Cover test', description: '', actionTypePattern: 'test.*',
        riskClass: 'C', enforcementPoint: 'post_execution', policyType: 'business',
        priority: 100, requireApproval: false, enabled: true,
      });

      const report = await service.runAudit({ tenantId: TENANT_A });

      const confidenceGaps = report.gaps.filter((g) => g.category === 'low_confidence');
      expect(confidenceGaps.some((g) => g.severity === 'critical')).toBe(true);
    });

    it('should not flag high-confidence decisions', async () => {
      await decisionLogRepo.append(TENANT_A, makeDecision({
        confidence: 0.95,
        status: 'generated',
      }));

      trustPolicies.set('test-surface', {
        surfaceId: 'test-surface', riskTier: 'low', modelPolicy: 'default', reviewMode: 'none',
      });
      surfaceBindings.set('test-surface', {
        surfaceId: 'test-surface', pattern: 'single_model', roles: { primary: { modelPolicy: 'default' } }, fallbackStrategy: 'safe_block',
      });
      await policyRuleRepo.create(TENANT_A, {
        name: 'Cover test', description: '', actionTypePattern: 'test.*',
        riskClass: 'C', enforcementPoint: 'post_execution', policyType: 'business',
        priority: 100, requireApproval: false, enabled: true,
      });

      const report = await service.runAudit({ tenantId: TENANT_A });

      const confidenceGaps = report.gaps.filter((g) => g.category === 'low_confidence');
      expect(confidenceGaps).toHaveLength(0);
    });
  });

  // =========================================================================
  // Unaudited tool gaps
  // =========================================================================

  describe('unaudited_tool gap detection', () => {
    it('should detect tools with zero policy rules', async () => {
      await decisionLogRepo.append(TENANT_A, makeDecision({ toolName: 'custom.action' }));

      trustPolicies.set('test-surface', {
        surfaceId: 'test-surface', riskTier: 'low', modelPolicy: 'default', reviewMode: 'none',
      });
      surfaceBindings.set('test-surface', {
        surfaceId: 'test-surface', pattern: 'single_model', roles: { primary: { modelPolicy: 'default' } }, fallbackStrategy: 'safe_block',
      });

      const report = await service.runAudit({ tenantId: TENANT_A });

      const unauditedGaps = report.gaps.filter((g) => g.category === 'unaudited_tool');
      expect(unauditedGaps.length).toBeGreaterThanOrEqual(1);
      expect(unauditedGaps[0].severity).toBe('info');
    });
  });

  // =========================================================================
  // Bypassed governance gaps
  // =========================================================================

  describe('bypassed_governance gap detection', () => {
    it('should detect auto-approved decisions that should require approval', async () => {
      // Create a risk class A rule requiring approval
      await policyRuleRepo.create(TENANT_A, {
        name: 'Deny dangerous',
        description: 'Requires approval for dangerous actions',
        actionTypePattern: 'danger.*',
        riskClass: 'A',
        enforcementPoint: 'pre_decision',
        policyType: 'safety',
        priority: 100,
        requireApproval: true,
        enabled: true,
      });

      // Create a decision that matches but was auto-approved
      await decisionLogRepo.append(TENANT_A, makeDecision({
        toolName: 'danger.execute',
        status: 'generated',
      }));

      trustPolicies.set('test-surface', {
        surfaceId: 'test-surface', riskTier: 'critical', modelPolicy: 'default', reviewMode: 'always',
      });
      surfaceBindings.set('test-surface', {
        surfaceId: 'test-surface', pattern: 'single_model', roles: { primary: { modelPolicy: 'default' } }, fallbackStrategy: 'safe_block',
      });

      const report = await service.runAudit({ tenantId: TENANT_A });

      const bypassGaps = report.gaps.filter((g) => g.category === 'bypassed_governance');
      expect(bypassGaps.length).toBe(1);
      expect(bypassGaps[0].severity).toBe('critical');
    });
  });

  // =========================================================================
  // Evidence integrity gaps
  // =========================================================================

  describe('evidence_integrity gap detection', () => {
    it('should detect tampered evidence chains', async () => {
      const correlationId = generateUuidV7();

      // Build a valid evidence chain
      evidenceChainService.append({
        correlationId,
        timestamp: new Date().toISOString(),
        tenantId: TENANT_A,
        operationType: 'input_received',
        payload: { action: 'test' },
      });

      // Tamper with the chain by directly modifying the record
      const chain = evidenceChainService.getChain(TENANT_A, correlationId)!;
      chain.records[0].auditHash = 'tampered-hash';

      // Add a decision referencing this correlation
      await decisionLogRepo.append(TENANT_A, makeDecision({ correlationId }));

      // Add trust + policy to avoid other gap types
      trustPolicies.set('test-surface', {
        surfaceId: 'test-surface', riskTier: 'low', modelPolicy: 'default', reviewMode: 'none',
      });
      surfaceBindings.set('test-surface', {
        surfaceId: 'test-surface', pattern: 'single_model', roles: { primary: { modelPolicy: 'default' } }, fallbackStrategy: 'safe_block',
      });
      await policyRuleRepo.create(TENANT_A, {
        name: 'Cover test', description: '', actionTypePattern: 'test.*',
        riskClass: 'C', enforcementPoint: 'post_execution', policyType: 'business',
        priority: 100, requireApproval: false, enabled: true,
      });

      const report = await service.runAudit({ tenantId: TENANT_A, includeEvidenceIntegrity: true });

      const integrityGaps = report.gaps.filter((g) => g.category === 'evidence_integrity');
      expect(integrityGaps.length).toBe(1);
      expect(integrityGaps[0].severity).toBe('critical');
    });

    it('should report valid evidence chains without gaps', async () => {
      const correlationId = generateUuidV7();

      evidenceChainService.append({
        correlationId,
        timestamp: new Date().toISOString(),
        tenantId: TENANT_A,
        operationType: 'input_received',
        payload: { action: 'test' },
      });

      await decisionLogRepo.append(TENANT_A, makeDecision({ correlationId }));

      trustPolicies.set('test-surface', {
        surfaceId: 'test-surface', riskTier: 'low', modelPolicy: 'default', reviewMode: 'none',
      });
      surfaceBindings.set('test-surface', {
        surfaceId: 'test-surface', pattern: 'single_model', roles: { primary: { modelPolicy: 'default' } }, fallbackStrategy: 'safe_block',
      });
      await policyRuleRepo.create(TENANT_A, {
        name: 'Cover test', description: '', actionTypePattern: 'test.*',
        riskClass: 'C', enforcementPoint: 'post_execution', policyType: 'business',
        priority: 100, requireApproval: false, enabled: true,
      });

      const report = await service.runAudit({ tenantId: TENANT_A, includeEvidenceIntegrity: true });

      const integrityGaps = report.gaps.filter((g) => g.category === 'evidence_integrity');
      expect(integrityGaps).toHaveLength(0);
      expect(report.summary.evidenceIntegrity).toBe(100);
    });
  });

  // =========================================================================
  // Evidence integrity check (direct)
  // =========================================================================

  describe('checkEvidenceIntegrity', () => {
    it('should return integrity status for correlation IDs', async () => {
      const correlationId = generateUuidV7();

      evidenceChainService.append({
        correlationId,
        timestamp: new Date().toISOString(),
        tenantId: TENANT_A,
        operationType: 'input_received',
        payload: { action: 'test' },
      });

      const result = await service.checkEvidenceIntegrity(TENANT_A, [correlationId]);

      expect(result.checked).toBe(1);
      expect(result.intact).toBe(1);
      expect(result.broken).toBe(0);
      expect(result.details[0].valid).toBe(true);
    });
  });

  // =========================================================================
  // Tenant isolation (negative control)
  // =========================================================================

  describe('tenant isolation', () => {
    it('should not return decisions from other tenants', async () => {
      // Add decisions to tenant A
      await decisionLogRepo.append(TENANT_A, makeDecision({
        toolName: 'sensitive.action',
        tenantId: TENANT_A,
      }));

      // Add decisions to tenant B
      await decisionLogRepo.append(TENANT_B, makeDecision({
        toolName: 'other.action',
        tenantId: TENANT_B,
      }));

      // Audit tenant B — should not see tenant A's decisions
      const report = await service.runAudit({ tenantId: TENANT_B });

      expect(report.tenantId).toBe(TENANT_B);
      expect(report.summary.totalDecisions).toBe(1);

      // Verify no gaps reference tenant A's tool
      const allDescriptions = report.gaps.map((g) => g.description).join(' ');
      expect(allDescriptions).not.toContain('sensitive.action');
    });

    it('should not access cross-tenant evidence chains', async () => {
      const correlationId = generateUuidV7();

      // Add evidence to tenant A
      evidenceChainService.append({
        correlationId,
        timestamp: new Date().toISOString(),
        tenantId: TENANT_A,
        operationType: 'input_received',
        payload: { secret: 'tenant-a-data' },
      });

      // Try to check evidence as tenant B
      const result = await service.checkEvidenceIntegrity(TENANT_B, [correlationId]);

      // Should not find the chain (it belongs to tenant A)
      expect(result.checked).toBe(1);
      // The chain won't be found for tenant B, so it reports as not valid
      expect(result.details[0].valid).toBe(false);
    });
  });

  // =========================================================================
  // Gap severity classification
  // =========================================================================

  describe('severity classification', () => {
    it('should use critical/warning/info levels', async () => {
      // Set up multiple gap scenarios
      await decisionLogRepo.append(TENANT_A, makeDecision({ toolName: 'db.drop', surface: 'no-trust' }));
      await decisionLogRepo.append(TENANT_A, makeDecision({ toolName: 'custom.read', surface: 'no-trust', confidence: 0.5 }));

      const report = await service.runAudit({ tenantId: TENANT_A });

      const severities = new Set(report.gaps.map((g) => g.severity));
      expect(severities.size).toBeGreaterThanOrEqual(1);
      // All severities should be valid
      for (const s of severities) {
        expect(['critical', 'warning', 'info']).toContain(s);
      }
    });
  });

  // =========================================================================
  // Recommendations
  // =========================================================================

  describe('recommendations', () => {
    it('should include actionable recommendations for each gap category', async () => {
      await decisionLogRepo.append(TENANT_A, makeDecision({ toolName: 'unknown.tool', surface: 'no-trust' }));

      const report = await service.runAudit({ tenantId: TENANT_A });

      expect(report.recommendations.length).toBeGreaterThan(0);
      for (const gap of report.gaps) {
        expect(gap.recommendation).toBeTruthy();
        expect(gap.recommendation.length).toBeGreaterThan(10);
      }
    });
  });

  // =========================================================================
  // Time range filtering
  // =========================================================================

  describe('time range filtering', () => {
    it('should respect time range bounds', async () => {
      await decisionLogRepo.append(TENANT_A, makeDecision({
        createdAt: '2025-01-01T00:00:00.000Z',
        toolName: 'old.action',
      }));
      await decisionLogRepo.append(TENANT_A, makeDecision({
        createdAt: '2026-06-01T00:00:00.000Z',
        toolName: 'new.action',
      }));

      trustPolicies.set('test-surface', {
        surfaceId: 'test-surface', riskTier: 'low', modelPolicy: 'default', reviewMode: 'none',
      });
      surfaceBindings.set('test-surface', {
        surfaceId: 'test-surface', pattern: 'single_model', roles: { primary: { modelPolicy: 'default' } }, fallbackStrategy: 'safe_block',
      });

      const report = await service.runAudit({
        tenantId: TENANT_A,
        timeRange: { from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z' },
      });

      expect(report.summary.totalDecisions).toBe(1);
    });
  });

  // =========================================================================
  // Surface filtering
  // =========================================================================

  describe('surface filtering', () => {
    it('should filter by specified surfaces', async () => {
      await decisionLogRepo.append(TENANT_A, makeDecision({ surface: 'surface-a' }));
      await decisionLogRepo.append(TENANT_A, makeDecision({ surface: 'surface-b' }));

      const report = await service.runAudit({
        tenantId: TENANT_A,
        surfaces: ['surface-a'],
      });

      expect(report.summary.totalDecisions).toBe(1);
    });
  });

  // =========================================================================
  // Markdown report formatting
  // =========================================================================

  describe('formatReportAsMarkdown', () => {
    it('should produce valid Markdown report', async () => {
      await decisionLogRepo.append(TENANT_A, makeDecision({ toolName: 'uncovered.tool' }));

      const report = await service.runAudit({ tenantId: TENANT_A });
      const markdown = formatReportAsMarkdown(report);

      expect(markdown).toContain('# Compliance Audit Report');
      expect(markdown).toContain('## Summary');
      expect(markdown).toContain('Policy Coverage');
      expect(markdown).toContain('## Gaps');
      expect(markdown).toContain('## Recommendations');
    });

    it('should show no gaps message when clean', async () => {
      const report = await service.runAudit({ tenantId: TENANT_A });
      const markdown = formatReportAsMarkdown(report);

      expect(markdown).toContain('No compliance gaps detected');
    });
  });

  // =========================================================================
  // Integration: seed decisions with known gaps, audit detects all
  // =========================================================================

  describe('integration: full gap detection', () => {
    it('should detect all gap types in a single audit', async () => {
      // 1. Tool with no policy rules (missing_policy + unaudited_tool)
      await decisionLogRepo.append(TENANT_A, makeDecision({ toolName: 'unknown.tool', surface: 'known-surface' }));

      // 2. Surface without trust tier (missing_trust_tier)
      await decisionLogRepo.append(TENANT_A, makeDecision({ toolName: 'known.action', surface: 'unregistered-surface' }));

      // 3. Low confidence decision (low_confidence)
      await decisionLogRepo.append(TENANT_A, makeDecision({
        toolName: 'known.action',
        confidence: 0.3,
        surface: 'known-surface',
      }));

      // 4. Bypassed governance
      await policyRuleRepo.create(TENANT_A, {
        name: 'Require approval for known', description: '',
        actionTypePattern: 'known.*', riskClass: 'A', enforcementPoint: 'pre_decision',
        policyType: 'safety', priority: 100, requireApproval: true, enabled: true,
      });

      // 5. Tampered evidence
      const correlationId = generateUuidV7();
      evidenceChainService.append({
        correlationId, timestamp: new Date().toISOString(), tenantId: TENANT_A,
        operationType: 'input_received', payload: { x: 1 },
      });
      const chain = evidenceChainService.getChain(TENANT_A, correlationId)!;
      chain.records[0].auditHash = 'tampered';
      await decisionLogRepo.append(TENANT_A, makeDecision({ correlationId, toolName: 'known.action', surface: 'known-surface' }));

      // Set up partial trust
      trustPolicies.set('known-surface', {
        surfaceId: 'known-surface', riskTier: 'low', modelPolicy: 'default', reviewMode: 'none',
      });
      surfaceBindings.set('known-surface', {
        surfaceId: 'known-surface', pattern: 'single_model', roles: { primary: { modelPolicy: 'default' } }, fallbackStrategy: 'safe_block',
      });

      const report = await service.runAudit({ tenantId: TENANT_A, includeEvidenceIntegrity: true });

      const categories = new Set(report.gaps.map((g) => g.category));

      expect(categories.has('missing_policy')).toBe(true);
      expect(categories.has('missing_trust_tier')).toBe(true);
      expect(categories.has('low_confidence')).toBe(true);
      expect(categories.has('bypassed_governance')).toBe(true);
      expect(categories.has('evidence_integrity')).toBe(true);
      expect(categories.has('unaudited_tool')).toBe(true);

      // Verify recommendations exist for all categories
      expect(report.recommendations.length).toBeGreaterThanOrEqual(5);
    });
  });
});
