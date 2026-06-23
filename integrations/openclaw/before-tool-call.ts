/**
 * OpenCLAW before_tool_call Hook Handler
 *
 * Maps Decision Core policy verdicts to OpenCLAW hook results:
 * - allow → pass (tool proceeds)
 * - deny → block with blockReason
 * - approve_required → requireApproval with title, description, severity
 */

import type { PolicyGuard } from '../../src/surfaces/sdk/types.js';
import type { PolicyVerdict } from '../../src/contracts/policy.contracts.js';
import type { ApprovalBridge } from './approval-bridge.js';
import { createLogger } from '../../src/utils/logger.js';

const logger = createLogger('openclaw-before-tool-call');

// ===========================================================================
// OpenCLAW Hook Result Types
// ===========================================================================

export interface PassResult {
  pass: true;
}

export interface BlockResult {
  block: true;
  blockReason: string;
}

/**
 * OpenClaw's approval-resolution enum (src/plugins/hook-types.ts
 * PluginApprovalResolutions). Decision Core consumes the real values rather
 * than a boolean so the audit trail can tell a human deny apart from a
 * timeout or a cancellation.
 */
export type OpenClawApprovalResolution =
  | 'allow-once'
  | 'allow-always'
  | 'deny'
  | 'timeout'
  | 'cancelled';

export interface RequireApprovalResult {
  requireApproval: {
    title: string;
    description: string;
    // OpenClaw severity enum (src/plugins/hook-types.ts) — NOT low/medium/high.
    severity: 'info' | 'warning' | 'critical';
    timeoutMs: number;
    timeoutBehavior: 'deny' | 'allow';
    onResolution: (decision: OpenClawApprovalResolution) => void | Promise<void>;
  };
}

export type BeforeToolCallResult = PassResult | BlockResult | RequireApprovalResult;

/** Whether an OpenClaw approval resolution means the action proceeds. */
export function isApprovalGranted(decision: OpenClawApprovalResolution): boolean {
  return decision === 'allow-once' || decision === 'allow-always';
}

// ===========================================================================
// Hook Context
// ===========================================================================

export interface ToolCallContext {
  toolName: string;
  toolParams: Record<string, unknown>;
  sessionId?: string;
  agentId?: string;
}

// ===========================================================================
// Configuration
// ===========================================================================

export interface BeforeToolCallConfig {
  guard: PolicyGuard;
  tenantId: string;
  surfaceId: string;
  failMode: 'closed' | 'open';
  approvalBridge: ApprovalBridge;
  approvalTimeoutMs?: number;
}

// ===========================================================================
// Verdict Mapping
// ===========================================================================

function extractReason(verdict: PolicyVerdict): string {
  if (verdict.matchedPolicies.length > 0) {
    return verdict.matchedPolicies[0].reason;
  }
  return 'policy denied this action';
}

function mapSeverity(verdict: PolicyVerdict): 'info' | 'warning' | 'critical' {
  if (verdict.matchedPolicies.length === 0) return 'warning';
  const rule = verdict.matchedPolicies[0];
  const name = rule.ruleName.toLowerCase();
  if (name.includes('safety') || name.includes('compliance')) return 'critical';
  return 'warning';
}

export function mapVerdictToHookResult(
  verdict: PolicyVerdict,
  toolName: string,
  approvalBridge: ApprovalBridge,
  timeoutMs: number,
): BeforeToolCallResult {
  switch (verdict.verdict) {
    case 'allow':
      return { pass: true };

    case 'deny':
      return {
        block: true,
        blockReason: extractReason(verdict),
      };

    case 'approve_required':
      return {
        requireApproval: {
          title: `Approval required: ${toolName}`,
          description: extractReason(verdict),
          severity: mapSeverity(verdict),
          timeoutMs,
          timeoutBehavior: 'deny',
          onResolution: (decision: OpenClawApprovalResolution) => {
            approvalBridge.recordResolution(toolName, verdict, isApprovalGranted(decision), decision);
          },
        },
      };
  }
}

// ===========================================================================
// Hook Factory
// ===========================================================================

export function makeBeforeToolCallHook(config: BeforeToolCallConfig) {
  const { guard, tenantId, surfaceId, failMode, approvalBridge, approvalTimeoutMs = 300_000 } = config;

  return async (ctx: ToolCallContext): Promise<BeforeToolCallResult> => {
    try {
      const verdict = await guard.evaluate(
        tenantId,
        surfaceId,
        ctx.toolName,
        { args: ctx.toolParams, sessionId: ctx.sessionId, agentId: ctx.agentId },
      );

      logger.debug({ toolName: ctx.toolName, verdict: verdict.verdict }, 'Policy evaluated');

      return mapVerdictToHookResult(verdict, ctx.toolName, approvalBridge, approvalTimeoutMs);
    } catch (err) {
      logger.error({ err, toolName: ctx.toolName }, 'Policy evaluation failed');

      if (failMode === 'open') {
        return { pass: true };
      }
      return {
        block: true,
        blockReason: 'Policy evaluation unavailable (fail-closed)',
      };
    }
  };
}
