import type { PolicyRule } from '../contracts/policy.contracts.js';
import type { AgentRegistryConfig } from '../identity/agent-registry.contracts.js';
import { findAgentsByRole } from '../identity/agent-registry.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('approval-routing');

export interface ApprovalTarget {
  role: string;
  agentIds: string[];
}

export function resolveApprover(
  rule: PolicyRule,
  registry: AgentRegistryConfig,
): ApprovalTarget | null {
  if (rule.approverRole) {
    const agents = findAgentsByRole(registry, rule.approverRole);
    return {
      role: rule.approverRole,
      agentIds: agents.map((a) => a.agentId),
    };
  }

  // Default hierarchy fallback
  if (rule.policyType === 'compliance') {
    const agents = findAgentsByRole(registry, 'compliance_officer');
    if (agents.length > 0) {
      return { role: 'compliance_officer', agentIds: agents.map((a) => a.agentId) };
    }
  }

  // Strategic actions default to CEO
  if (rule.policyType === 'safety' || rule.actionTypePattern.startsWith('strategic_')) {
    const agents = findAgentsByRole(registry, 'ceo');
    if (agents.length > 0) {
      return { role: 'ceo', agentIds: agents.map((a) => a.agentId) };
    }
  }

  logger.warn({ ruleId: rule.id, ruleName: rule.name }, 'No approver found for rule');
  return null;
}

export interface SeparationOfDutiesCheck {
  allowed: boolean;
  reason?: string;
}

export function checkSeparationOfDuties(
  requestedBy: string,
  resolvedBy: string,
  resolverRoles: string[],
  breakGlass?: { reason: string; expiresAt: string },
): SeparationOfDutiesCheck {
  if (requestedBy !== resolvedBy) {
    return { allowed: true };
  }

  // Self-approval — only allowed with break-glass
  if (!breakGlass) {
    return {
      allowed: false,
      reason: 'Separation of duties: requester cannot approve their own request',
    };
  }

  if (!resolverRoles.includes('ceo')) {
    return {
      allowed: false,
      reason: 'Break-glass self-approval requires CEO role',
    };
  }

  if (!breakGlass.reason || breakGlass.reason.trim().length === 0) {
    return {
      allowed: false,
      reason: 'Break-glass self-approval requires an explicit reason',
    };
  }

  const expiresAt = new Date(breakGlass.expiresAt);
  if (isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    return {
      allowed: false,
      reason: 'Break-glass self-approval requires a valid future expiry timestamp',
    };
  }

  logger.warn(
    { requestedBy, reason: breakGlass.reason, expiresAt: breakGlass.expiresAt },
    'Break-glass self-approval granted',
  );

  return { allowed: true };
}
