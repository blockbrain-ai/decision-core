/**
 * Safe-default rule proposal (E1) — when an agent gains a new tool, propose a
 * policy rule for it, defaulted to the SAFE side (block for high-risk, approval
 * for medium, allow only for clearly read-only) until a human confirms. This is
 * the maintenance primitive: the agent proposes, the human approves, the policy
 * never silently goes stale.
 *
 * Pure + advisory: this NEVER applies a rule. Callers route the proposal through
 * the normal mutating path (e.g. `ingest_policy` / `rescan --apply`) after a human
 * confirms — same gating/backup/validation as any policy change.
 */

import { classifyDetectedTools } from './tool-risk-classifier.js';

export interface ProposedRule {
  toolName: string;
  riskTier: number;
  /** The would-be enforcement verdict for this tool. */
  verdict: 'allow' | 'approve_required' | 'deny';
  /** A PolicyRuleCreateInput-shaped rule (safe-defaulted). */
  rule: Record<string, unknown>;
  rationale: string;
}

/** Propose a single safe-defaulted rule for a (new) tool. `denyNew` forces deny. */
export function proposeRuleForTool(toolName: string, opts?: { denyNew?: boolean }): ProposedRule {
  const [candidate] = classifyDetectedTools([toolName]);
  const riskTier = candidate?.riskTier ?? 3;

  const rule: Record<string, unknown> = {
    name: `auto-${toolName}`,
    description: `Auto-proposed rule for newly detected tool ${toolName} (risk tier ${riskTier})`,
    actionTypePattern: toolName,
    riskClass: riskTier >= 3 ? 'A' : riskTier >= 2 ? 'B' : 'C',
    enforcementPoint: 'pre_decision',
    policyType: riskTier >= 3 ? 'safety' : 'business',
    requireApproval: false,
    enabled: true,
    priority: 50,
  };

  let verdict: ProposedRule['verdict'];
  if (opts?.denyNew || riskTier >= 4) {
    rule['defaultVerdict'] = 'deny';
    rule['priority'] = 90;
    verdict = 'deny';
  } else if (riskTier >= 2) {
    rule['requireApproval'] = true;
    rule['priority'] = 70;
    verdict = 'approve_required';
  } else {
    verdict = 'allow';
  }

  return {
    toolName,
    riskTier,
    verdict,
    rule,
    rationale:
      verdict === 'deny'
        ? `High-risk tool (tier ${riskTier}) — proposed DENY until you confirm.`
        : verdict === 'approve_required'
          ? `State-changing tool (tier ${riskTier}) — proposed human APPROVAL until you confirm.`
          : `Read-only tool (tier ${riskTier}) — proposed ALLOW.`,
  };
}

/** Tools (by name) that have no matching rule in the current pack patterns — policy drift. */
export function findUngovernedTools(toolNames: string[], existingPatterns: string[]): string[] {
  const patternSet = new Set(existingPatterns);
  // A tool is "governed" if its exact name is a pattern, or a glob pattern would
  // plausibly cover it. We keep this conservative: exact match or a prefix glob.
  return toolNames.filter((name) => {
    if (patternSet.has(name)) return false;
    for (const p of existingPatterns) {
      if (p.endsWith('*') && name.startsWith(p.slice(0, -1))) return false;
    }
    return true;
  });
}
