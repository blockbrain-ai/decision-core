/**
 * Autonomy Level
 *
 * Controls how strictly policy enforcement applies.
 *
 * - strict:     all verdicts enforced; deny blocks, approve_required blocks
 * - permissive: deny blocks, approve_required logged but treated as allow
 * - advisory:   all verdicts logged but never block execution
 *
 * An explicit deny is NEVER overridden regardless of autonomy mode.
 * In permissive mode, deny still blocks. Only approve_required is relaxed.
 * In advisory mode, the verdict is returned but enforcement does not block.
 */

import type { VerdictResult } from '../contracts/policy.contracts.js';

export const AUTONOMY_MODES = ['strict', 'permissive', 'advisory'] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export interface AutonomyEffect {
  shouldBlock: boolean;
  effectiveVerdict: VerdictResult;
  mode: AutonomyMode;
}

export function resolveAutonomyMode(autonomyLevel: number): AutonomyMode {
  if (autonomyLevel <= 1) return 'strict';
  if (autonomyLevel <= 3) return 'permissive';
  return 'advisory';
}

export function applyAutonomyEffect(
  verdict: VerdictResult,
  mode: AutonomyMode,
): AutonomyEffect {
  switch (mode) {
    case 'strict':
      return {
        shouldBlock: verdict === 'deny' || verdict === 'approve_required',
        effectiveVerdict: verdict,
        mode,
      };
    case 'permissive':
      return {
        shouldBlock: verdict === 'deny',
        effectiveVerdict: verdict === 'approve_required' ? 'allow' : verdict,
        mode,
      };
    case 'advisory':
      return {
        shouldBlock: false,
        effectiveVerdict: verdict,
        mode,
      };
  }
}
