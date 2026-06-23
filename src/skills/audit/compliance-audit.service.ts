/**
 * Compliance Audit Service
 *
 * Reviews recent decisions, identifies governance gaps (missing policies,
 * low-confidence auto-approves, surfaces without trust tiers, unaudited
 * tool categories), and generates structured compliance reports.
 *
 * Read-only: never modifies decisions or policies.
 * Tenant-scoped: only accesses the requesting tenant's data (D2).
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { DecisionRecord } from '../../contracts/decision.contracts.js';
import type { PolicyRule } from '../../contracts/policy.contracts.js';
import type {
  ComplianceAuditRequest,
  ComplianceAuditReport,
  ComplianceGap,
  GapSeverity,
  EvidenceIntegrityResult,
} from '../../contracts/compliance-audit.contracts.js';
import type { DecisionLogRepository } from '../../persistence/interfaces/decision-log.repository.js';
import type { PolicyRuleRepository } from '../../persistence/interfaces/policy-rule.repository.js';
import type { TrustPolicyEntry, SurfaceBinding } from '../../trust/trust.contracts.js';
import type { EvidenceChainService } from '../../integrity/evidence-chain.service.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('compliance-audit');

const LOW_CONFIDENCE_THRESHOLD = 0.7;

export interface ComplianceAuditDeps {
  decisionLogRepo: DecisionLogRepository;
  policyRuleRepo: PolicyRuleRepository;
  evidenceChainService?: EvidenceChainService;
  /** Lookup function for trust policy entries by surfaceId */
  getTrustPolicy?: (surfaceId: string) => TrustPolicyEntry | null;
  /** Lookup function for surface bindings by surfaceId */
  getSurfaceBinding?: (surfaceId: string) => SurfaceBinding | null;
}

export class ComplianceAuditService {
  private deps: ComplianceAuditDeps;

  constructor(deps: ComplianceAuditDeps) {
    this.deps = deps;
  }

  /**
   * Run a full compliance audit and return a structured report.
   */
  async runAudit(request: ComplianceAuditRequest): Promise<ComplianceAuditReport> {
    const tenantId = request.tenantId as TenantId;
    const now = new Date().toISOString();
    const timeRange = {
      from: request.timeRange?.from ?? '1970-01-01T00:00:00.000Z',
      to: request.timeRange?.to ?? now,
    };

    logger.info({ tenantId, timeRange }, 'Starting compliance audit');

    // Fetch decisions in time range
    const decisions = await this.deps.decisionLogRepo.findAll(tenantId, {
      from: timeRange.from,
      to: timeRange.to,
    });

    // Filter by surfaces if specified
    const filteredDecisions = request.surfaces?.length
      ? decisions.filter((d) => request.surfaces!.includes(d.surface))
      : decisions;

    // Fetch all policy rules
    const policyRules = await this.deps.policyRuleRepo.findAll(tenantId);

    // Detect gaps
    const gaps = await this.detectGaps(tenantId, filteredDecisions, policyRules, request);

    // Calculate coverage metrics
    const policyCoverage = this.calculatePolicyCoverage(filteredDecisions, policyRules);
    const evidenceIntegrity = request.includeEvidenceIntegrity !== false
      ? await this.calculateEvidenceIntegrity(tenantId, filteredDecisions)
      : 100;

    const gapCount = {
      critical: gaps.filter((g) => g.severity === 'critical').length,
      warning: gaps.filter((g) => g.severity === 'warning').length,
      info: gaps.filter((g) => g.severity === 'info').length,
    };

    const recommendations = this.generateRecommendations(gaps);

    const report: ComplianceAuditReport = {
      tenantId: request.tenantId,
      generatedAt: now,
      timeRange,
      summary: {
        totalDecisions: filteredDecisions.length,
        policyCoverage,
        evidenceIntegrity,
        gapCount,
      },
      gaps,
      recommendations,
    };

    logger.info(
      { tenantId, totalDecisions: filteredDecisions.length, gapCount },
      'Compliance audit complete',
    );

    return report;
  }

  /**
   * Detect all governance gaps from decisions and policy rules.
   */
  async detectGaps(
    tenantId: TenantId,
    decisions: DecisionRecord[],
    policyRules: PolicyRule[],
    request: ComplianceAuditRequest,
  ): Promise<ComplianceGap[]> {
    const gaps: ComplianceGap[] = [];

    gaps.push(...this.detectMissingPolicyGaps(decisions, policyRules));
    gaps.push(...this.detectMissingTrustTierGaps(decisions));
    gaps.push(...this.detectLowConfidenceGaps(decisions));
    gaps.push(...this.detectUnauditedToolGaps(decisions, policyRules));
    gaps.push(...this.detectBypassedGovernanceGaps(decisions, policyRules));

    if (request.includeEvidenceIntegrity !== false) {
      const evidenceGaps = await this.detectEvidenceIntegrityGaps(tenantId, decisions);
      gaps.push(...evidenceGaps);
    }

    return gaps;
  }

  /**
   * Check evidence integrity for specific correlation IDs.
   */
  async checkEvidenceIntegrity(
    tenantId: string,
    correlationIds: string[],
  ): Promise<EvidenceIntegrityResult> {
    const details: EvidenceIntegrityResult['details'] = [];
    let intact = 0;
    let broken = 0;

    for (const correlationId of correlationIds) {
      if (!this.deps.evidenceChainService) {
        details.push({ correlationId, valid: true, recordCount: 0, error: 'No evidence chain service configured' });
        continue;
      }

      const result = this.deps.evidenceChainService.verify(tenantId, correlationId);
      details.push({
        correlationId,
        valid: result.valid,
        recordCount: result.recordCount,
        error: result.error,
      });

      if (result.valid) {
        intact++;
      } else {
        broken++;
      }
    }

    return {
      tenantId,
      checked: correlationIds.length,
      intact,
      broken,
      details,
    };
  }

  // ===========================================================================
  // Gap Detection Methods
  // ===========================================================================

  /**
   * Identify tools that appear in decisions but have no matching policy rules.
   */
  private detectMissingPolicyGaps(
    decisions: DecisionRecord[],
    policyRules: PolicyRule[],
  ): ComplianceGap[] {
    const gaps: ComplianceGap[] = [];
    const toolNames = new Set(decisions.map((d) => d.toolName));
    const enabledRules = policyRules.filter((r) => r.enabled);

    for (const toolName of toolNames) {
      const hasMatchingRule = enabledRules.some((rule) => {
        const pattern = rule.actionTypePattern.replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`).test(toolName);
      });

      if (!hasMatchingRule) {
        const affectedDecisions = decisions
          .filter((d) => d.toolName === toolName)
          .map((d) => d.id);
        const affectedSurfaces = [...new Set(
          decisions.filter((d) => d.toolName === toolName).map((d) => d.surface),
        )];

        // Severity depends on whether the surface is critical
        const severity = this.classifyToolSeverity(toolName, affectedSurfaces);

        gaps.push({
          id: generateUuidV7(),
          severity,
          category: 'missing_policy',
          description: `Tool "${toolName}" has no matching enabled policy rules. ${affectedDecisions.length} decision(s) were made without policy coverage.`,
          affectedSurfaces,
          affectedDecisions,
          recommendation: `Create a policy rule covering "${toolName}" using the policy author skill (dc_author_from_text). Consider the risk level of this tool and whether it should require approval.`,
        });
      }
    }

    return gaps;
  }

  /**
   * Identify surfaces in decision history without trust tier assignments.
   */
  private detectMissingTrustTierGaps(decisions: DecisionRecord[]): ComplianceGap[] {
    const gaps: ComplianceGap[] = [];
    const surfaces = new Set(decisions.map((d) => d.surface));

    for (const surfaceId of surfaces) {
      if (!this.deps.getTrustPolicy) continue;

      const trustEntry = this.deps.getTrustPolicy(surfaceId);
      if (!trustEntry) {
        const affectedDecisions = decisions
          .filter((d) => d.surface === surfaceId)
          .map((d) => d.id);

        gaps.push({
          id: generateUuidV7(),
          severity: 'critical',
          category: 'missing_trust_tier',
          description: `Surface "${surfaceId}" has no trust tier assignment. ${affectedDecisions.length} decision(s) were routed without trust-level governance.`,
          affectedSurfaces: [surfaceId],
          affectedDecisions,
          recommendation: `Add a trust policy entry for surface "${surfaceId}" in the trust suite configuration. Assign an appropriate risk tier (critical/intermediate/low) and review mode.`,
        });
      }
    }

    // Also check for surfaces without bindings
    for (const surfaceId of surfaces) {
      if (!this.deps.getSurfaceBinding) continue;

      const binding = this.deps.getSurfaceBinding(surfaceId);
      if (!binding) {
        // Only add if we haven't already flagged this surface for missing trust tier
        const alreadyFlagged = gaps.some(
          (g) => g.category === 'missing_trust_tier' && g.affectedSurfaces.includes(surfaceId),
        );
        if (!alreadyFlagged) {
          const affectedDecisions = decisions
            .filter((d) => d.surface === surfaceId)
            .map((d) => d.id);

          gaps.push({
            id: generateUuidV7(),
            severity: 'warning',
            category: 'missing_trust_tier',
            description: `Surface "${surfaceId}" has a trust policy but no surface binding configuration.`,
            affectedSurfaces: [surfaceId],
            affectedDecisions,
            recommendation: `Add a surface binding for "${surfaceId}" to define its routing pattern, fallback strategy, and model assignments.`,
          });
        }
      }
    }

    return gaps;
  }

  /**
   * Flag decisions where verdict was allow but confidence was below threshold.
   */
  private detectLowConfidenceGaps(decisions: DecisionRecord[]): ComplianceGap[] {
    const gaps: ComplianceGap[] = [];

    const lowConfidenceDecisions = decisions.filter(
      (d) => d.status === 'generated' && d.confidence < LOW_CONFIDENCE_THRESHOLD,
    );

    if (lowConfidenceDecisions.length > 0) {
      // Group by surface
      const bySurface = new Map<string, DecisionRecord[]>();
      for (const d of lowConfidenceDecisions) {
        const existing = bySurface.get(d.surface) ?? [];
        existing.push(d);
        bySurface.set(d.surface, existing);
      }

      for (const [surfaceId, surfaceDecisions] of bySurface) {
        const avgConfidence = surfaceDecisions.reduce((sum, d) => sum + d.confidence, 0) / surfaceDecisions.length;

        gaps.push({
          id: generateUuidV7(),
          severity: avgConfidence < 0.4 ? 'critical' : 'warning',
          category: 'low_confidence',
          description: `${surfaceDecisions.length} decision(s) on surface "${surfaceId}" had confidence below ${LOW_CONFIDENCE_THRESHOLD} (avg: ${avgConfidence.toFixed(2)}). These auto-approvals may not meet governance standards.`,
          affectedSurfaces: [surfaceId],
          affectedDecisions: surfaceDecisions.map((d) => d.id),
          recommendation: `Review the routing pattern for surface "${surfaceId}". Consider switching to a primary-reviewer or tribunal pattern, or adding a confidence threshold policy rule.`,
        });
      }
    }

    return gaps;
  }

  /**
   * Identify tools in decisions that have no policy rules at all (even disabled).
   */
  private detectUnauditedToolGaps(
    decisions: DecisionRecord[],
    policyRules: PolicyRule[],
  ): ComplianceGap[] {
    const gaps: ComplianceGap[] = [];
    const toolNames = new Set(decisions.map((d) => d.toolName));

    for (const toolName of toolNames) {
      const hasAnyRule = policyRules.some((rule) => {
        const pattern = rule.actionTypePattern.replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`).test(toolName);
      });

      if (!hasAnyRule) {
        const affectedDecisions = decisions
          .filter((d) => d.toolName === toolName)
          .map((d) => d.id);
        const affectedSurfaces = [...new Set(
          decisions.filter((d) => d.toolName === toolName).map((d) => d.surface),
        )];

        gaps.push({
          id: generateUuidV7(),
          severity: 'info',
          category: 'unaudited_tool',
          description: `Tool "${toolName}" has no policy rules (not even disabled drafts). It is completely outside governance.`,
          affectedSurfaces,
          affectedDecisions,
          recommendation: `Use the policy author skill to create rules for "${toolName}". Even if you want to allow all actions, having an explicit allow rule documents the intent.`,
        });
      }
    }

    return gaps;
  }

  /**
   * Detect decisions that bypassed expected governance patterns.
   */
  private detectBypassedGovernanceGaps(
    decisions: DecisionRecord[],
    policyRules: PolicyRule[],
  ): ComplianceGap[] {
    const gaps: ComplianceGap[] = [];

    // Find decisions on high-risk tools that were auto-approved
    const highRiskRules = policyRules.filter(
      (r) => r.riskClass === 'A' && r.requireApproval && r.enabled,
    );

    for (const rule of highRiskRules) {
      const pattern = rule.actionTypePattern.replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`);

      const matchingDecisions = decisions.filter(
        (d) => regex.test(d.toolName) && d.status === 'generated',
      );

      if (matchingDecisions.length > 0) {
        gaps.push({
          id: generateUuidV7(),
          severity: 'critical',
          category: 'bypassed_governance',
          description: `${matchingDecisions.length} decision(s) matching rule "${rule.name}" (risk class A, approval required) were auto-approved without going through the approval workflow.`,
          affectedSurfaces: [...new Set(matchingDecisions.map((d) => d.surface))],
          affectedDecisions: matchingDecisions.map((d) => d.id),
          recommendation: `Investigate why approval was bypassed for rule "${rule.name}". Verify that the enforcement point (${rule.enforcementPoint}) is correctly wired in the decision pipeline.`,
        });
      }
    }

    return gaps;
  }

  /**
   * Detect evidence chain integrity failures.
   */
  private async detectEvidenceIntegrityGaps(
    tenantId: TenantId,
    decisions: DecisionRecord[],
  ): Promise<ComplianceGap[]> {
    if (!this.deps.evidenceChainService) return [];

    const gaps: ComplianceGap[] = [];
    const correlationIds = [...new Set(decisions.map((d) => d.correlationId))];

    for (const correlationId of correlationIds) {
      // Skip chains that don't exist — absence is not tampering
      const chain = this.deps.evidenceChainService.getChain(tenantId, correlationId);
      if (!chain) continue;

      const result = this.deps.evidenceChainService.verify(tenantId, correlationId);

      if (!result.valid) {
        const affectedDecisions = decisions
          .filter((d) => d.correlationId === correlationId)
          .map((d) => d.id);
        const affectedSurfaces = [...new Set(
          decisions.filter((d) => d.correlationId === correlationId).map((d) => d.surface),
        )];

        gaps.push({
          id: generateUuidV7(),
          severity: 'critical',
          category: 'evidence_integrity',
          description: `Evidence chain for correlation "${correlationId}" has been tampered with or is corrupted. ${result.error ?? 'Hash verification failed.'}`,
          affectedSurfaces,
          affectedDecisions,
          recommendation: `Investigate the evidence chain for correlation "${correlationId}". Record at sequence ${result.brokenAt ?? 'unknown'} failed verification. This may indicate data tampering or a system bug.`,
        });
      }
    }

    return gaps;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private classifyToolSeverity(toolName: string, surfaces: string[]): GapSeverity {
    const sensitivePatterns = [
      /^db\./,
      /^payment\./,
      /^deploy\./,
      /\.delete$/,
      /\.drop$/,
      /^admin\./,
      /^auth\./,
    ];

    const isSensitive = sensitivePatterns.some((p) => p.test(toolName));
    if (isSensitive) return 'critical';

    // Check if any affected surface is critical via trust policies
    if (this.deps.getTrustPolicy) {
      for (const surfaceId of surfaces) {
        const entry = this.deps.getTrustPolicy(surfaceId);
        if (entry?.riskTier === 'critical') return 'critical';
      }
    }

    return 'warning';
  }

  private calculatePolicyCoverage(decisions: DecisionRecord[], policyRules: PolicyRule[]): number {
    if (decisions.length === 0) return 100;

    const enabledRules = policyRules.filter((r) => r.enabled);
    let covered = 0;

    for (const decision of decisions) {
      const hasCoverage = enabledRules.some((rule) => {
        const pattern = rule.actionTypePattern.replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`).test(decision.toolName);
      });
      if (hasCoverage) covered++;
    }

    return Math.round((covered / decisions.length) * 100);
  }

  private async calculateEvidenceIntegrity(
    tenantId: TenantId,
    decisions: DecisionRecord[],
  ): Promise<number> {
    if (!this.deps.evidenceChainService || decisions.length === 0) return 100;

    const correlationIds = [...new Set(decisions.map((d) => d.correlationId))];
    let checked = 0;
    let intact = 0;

    for (const correlationId of correlationIds) {
      const chain = this.deps.evidenceChainService.getChain(tenantId, correlationId);
      if (!chain) continue; // No chain to verify — not a failure
      checked++;
      const result = this.deps.evidenceChainService.verify(tenantId, correlationId);
      if (result.valid) intact++;
    }

    return checked > 0
      ? Math.round((intact / checked) * 100)
      : 100;
  }

  private generateRecommendations(gaps: ComplianceGap[]): string[] {
    const recommendations: string[] = [];
    const categories = new Set(gaps.map((g) => g.category));

    if (categories.has('missing_policy')) {
      recommendations.push(
        'Create policy rules for uncovered tools using "decision-core author" or the dc_author_from_text MCP tool.',
      );
    }

    if (categories.has('missing_trust_tier')) {
      recommendations.push(
        'Assign trust tiers to all active surfaces in the trust suite configuration.',
      );
    }

    if (categories.has('evidence_integrity')) {
      recommendations.push(
        'Investigate evidence chain integrity failures immediately. Tampered evidence chains may indicate a security incident.',
      );
    }

    if (categories.has('low_confidence')) {
      recommendations.push(
        'Review routing patterns for surfaces with low-confidence decisions. Consider upgrading to primary-reviewer or tribunal patterns.',
      );
    }

    if (categories.has('unaudited_tool')) {
      recommendations.push(
        'Document governance intent for all tools, even those that should be freely allowed. Explicit allow rules make audits clearer.',
      );
    }

    if (categories.has('bypassed_governance')) {
      recommendations.push(
        'Verify enforcement point wiring for all risk class A rules. Bypassed governance is a critical finding.',
      );
    }

    if (gaps.length === 0) {
      recommendations.push(
        'No compliance gaps detected. Continue monitoring with periodic audits.',
      );
    }

    return recommendations;
  }
}

/**
 * Format a compliance report as Markdown.
 */
export function formatReportAsMarkdown(report: ComplianceAuditReport): string {
  const lines: string[] = [];

  lines.push('# Compliance Audit Report');
  lines.push('');
  lines.push(`**Tenant:** ${report.tenantId}`);
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push(`**Time Range:** ${report.timeRange.from} to ${report.timeRange.to}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Decisions | ${report.summary.totalDecisions} |`);
  lines.push(`| Policy Coverage | ${report.summary.policyCoverage}% |`);
  lines.push(`| Evidence Integrity | ${report.summary.evidenceIntegrity}% |`);
  lines.push(`| Critical Gaps | ${report.summary.gapCount.critical} |`);
  lines.push(`| Warning Gaps | ${report.summary.gapCount.warning} |`);
  lines.push(`| Info Gaps | ${report.summary.gapCount.info} |`);
  lines.push('');

  if (report.gaps.length > 0) {
    lines.push('## Gaps');
    lines.push('');

    const bySeverity = { critical: [] as ComplianceGap[], warning: [] as ComplianceGap[], info: [] as ComplianceGap[] };
    for (const gap of report.gaps) {
      bySeverity[gap.severity].push(gap);
    }

    for (const severity of ['critical', 'warning', 'info'] as const) {
      const gapsOfSeverity = bySeverity[severity];
      if (gapsOfSeverity.length === 0) continue;

      const icon = severity === 'critical' ? 'CRITICAL' : severity === 'warning' ? 'WARNING' : 'INFO';
      lines.push(`### ${icon}`);
      lines.push('');

      for (const gap of gapsOfSeverity) {
        lines.push(`- **[${gap.category}]** ${gap.description}`);
        lines.push(`  - Surfaces: ${gap.affectedSurfaces.join(', ') || 'none'}`);
        lines.push(`  - Decisions: ${gap.affectedDecisions.length}`);
        lines.push(`  - Recommendation: ${gap.recommendation}`);
        lines.push('');
      }
    }
  } else {
    lines.push('## Gaps');
    lines.push('');
    lines.push('No compliance gaps detected.');
    lines.push('');
  }

  if (report.recommendations.length > 0) {
    lines.push('## Recommendations');
    lines.push('');
    for (const rec of report.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
