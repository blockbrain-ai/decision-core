/**
 * Policy Context Types
 *
 * Internal types used by PDP and PEP for evaluation and enforcement.
 * Contract types (PolicyContext, PolicyVerdict, etc.) live in
 * src/contracts/policy.contracts.ts — this module defines
 * supplementary types for internal engine use.
 */

import type { VerdictResult, EnforcementPoint } from '../contracts/policy.contracts.js';
import type { AutonomyMode } from './autonomy-level.js';

export interface EvaluationRequest {
  enforcementPoint: EnforcementPoint;
  actionType: string;
  financialImpact?: number;
  dataQualityScore?: number;
  confidence?: number;
  autonomyLevel?: number;
  correlationId: string;
}

export interface EnforcementResult {
  allowed: boolean;
  verdict: VerdictResult;
  autonomyMode: AutonomyMode;
  matchedPolicies: Array<{
    ruleId: string;
    ruleName: string;
    verdict: VerdictResult;
    reason: string;
  }>;
  explanation: string;
  correlationId: string;
}

export interface EnforcementOptions {
  autonomyLevel?: number;
  correlationId?: string;
  financialImpact?: number;
  dataQualityScore?: number;
  confidence?: number;
}
