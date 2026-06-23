/**
 * OpenCLAW Approval Bridge
 *
 * Bridges Decision Core's approve_required verdict to OpenCLAW's
 * native requireApproval system. Records approval resolutions back
 * to Decision Core as audit evidence.
 */

import type { PolicyVerdict } from '../../src/contracts/policy.contracts.js';
import { createLogger } from '../../src/utils/logger.js';

const logger = createLogger('openclaw-approval-bridge');

// ===========================================================================
// Types
// ===========================================================================

export interface ApprovalRecord {
  toolName: string;
  verdict: PolicyVerdict;
  approved: boolean;
  /** Raw OpenClaw resolution: allow-once/allow-always/deny/timeout/cancelled. */
  resolution?: string;
  resolvedAt: string;
  correlationId: string;
}

export interface AuditSink {
  record(entry: {
    surfaceId: string;
    toolName: string;
    operationType: string;
    payload: Record<string, unknown>;
    correlationId: string;
  }): void;
}

// ===========================================================================
// Approval Bridge
// ===========================================================================

export class ApprovalBridge {
  private readonly surfaceId: string;
  private readonly auditSink: AuditSink;
  private readonly resolutions: ApprovalRecord[] = [];

  constructor(surfaceId: string, auditSink: AuditSink) {
    this.surfaceId = surfaceId;
    this.auditSink = auditSink;
  }

  recordResolution(
    toolName: string,
    verdict: PolicyVerdict,
    approved: boolean,
    resolution?: string,
  ): void {
    const correlationId = crypto.randomUUID();
    const record: ApprovalRecord = {
      toolName,
      verdict,
      approved,
      resolution,
      resolvedAt: new Date().toISOString(),
      correlationId,
    };

    this.resolutions.push(record);

    logger.info(
      { toolName, approved, resolution, correlationId },
      'Approval resolution recorded',
    );

    this.auditSink.record({
      surfaceId: this.surfaceId,
      toolName,
      operationType: 'approval_resolution',
      payload: {
        approved,
        resolution,
        verdict: verdict.verdict,
        matchedPolicies: verdict.matchedPolicies.map((p) => ({
          ruleId: p.ruleId,
          ruleName: p.ruleName,
        })),
      },
      correlationId,
    });
  }

  getResolutions(): readonly ApprovalRecord[] {
    return this.resolutions;
  }
}
