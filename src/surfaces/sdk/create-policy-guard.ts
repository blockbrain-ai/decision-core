import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyVerdict } from '../../contracts/policy.contracts.js';
import { PolicyDecisionPoint } from '../../policy/policy-decision-point.js';
import { InMemoryPolicyRuleRepository } from '../../persistence/memory/in-memory-policy-rule.repository.js';
import { NoOpEventService } from '../../adapters/event-service.js';
import { loadAndSeedPolicyPack } from './policy-pack-loader.js';
import { PolicyGuardConfigSchema, type PolicyGuardConfig, type PolicyGuard } from './types.js';
import { tryLoadAgentRegistry, resolveAgentRoles } from '../../identity/agent-registry.js';
import type { AgentRegistryConfig } from '../../identity/agent-registry.contracts.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('create-policy-guard');

export async function createPolicyGuard(config: Partial<PolicyGuardConfig> = {}): Promise<PolicyGuard> {
  const parsed = PolicyGuardConfigSchema.parse(config);

  const policyRuleRepo = new InMemoryPolicyRuleRepository();
  const eventService = new NoOpEventService();
  const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);

  let denyUnknown = parsed.denyUnknownDefault ?? false;
  const enforcementMode = parsed.enforcementMode ?? 'enforce';

  if (parsed.policyPackPath) {
    const seedResult = await loadAndSeedPolicyPack(parsed.policyPackPath, parsed.tenantId, policyRuleRepo);
    if (seedResult.denyUnknownDefault) {
      denyUnknown = true;
    }
  }

  let agentRegistry: AgentRegistryConfig | null = null;
  if (parsed.agentRegistryPath) {
    agentRegistry = tryLoadAgentRegistry(parsed.agentRegistryPath);
    if (agentRegistry) {
      logger.info({ agentCount: agentRegistry.agents.length }, 'Agent registry loaded for PolicyGuard');
    }
  }

  logger.info(
    { tenantId: parsed.tenantId, hasPolicyPack: !!parsed.policyPackPath, denyUnknown, hasRegistry: !!agentRegistry },
    'Policy Guard instance created',
  );

  return {
    async evaluate(
      tenantId: string,
      _surfaceId: string,
      action: string,
      context?: Record<string, unknown>,
    ): Promise<PolicyVerdict> {
      const agentId = context?.agentId as string | undefined;
      // Trusted-role rule: when an agent registry is configured, roles come ONLY
      // from the authenticated identity (the registry, keyed by agentId) — a
      // caller-supplied context.callerRoles is IGNORED, because on a network
      // surface it is spoofable. With no registry, the in-process host's
      // context.callerRoles is the trust boundary (the host vouches for them).
      const callerRoles = agentRegistry
        ? (agentId ? resolveAgentRoles(agentRegistry, agentId) : undefined)
        : (context?.callerRoles as string[] | undefined);

      const result = await pdp.evaluate(
        tenantId as TenantId,
        {
          enforcementPoint: 'pre_decision',
          actionType: action,
          financialImpact: context?.financialImpact as number | undefined,
          dataQualityScore: context?.dataQualityScore as number | undefined,
          confidence: context?.confidence as number | undefined,
          autonomyLevel: context?.autonomyLevel as number | undefined,
          agentId,
          callerRoles,
        },
      );

      // Compute the real (enforced) verdict: apply deny-unknown to an unmatched allow.
      const effective: PolicyVerdict =
        denyUnknown && result.verdict === 'allow' && result.matchedPolicies.length === 0
          ? {
              verdict: 'deny',
              matchedPolicies: [{
                ruleId: 'deny-unknown',
                ruleName: 'deny-unknown-default',
                verdict: 'deny',
                reason: 'No policy rules matched — unknown actions denied by default',
              }],
            }
          : result;

      // Observe mode: NEVER block. Return allow, but preserve the would-be verdict
      // as observedVerdict so the operator can see exactly what enforce would do.
      // Fully non-enforcing: shadows deny AND approve_required, deny-unknown and
      // explicit rules alike.
      if (enforcementMode === 'observe') {
        if (effective.verdict !== 'allow') {
          logger.info(
            { action, observedVerdict: effective.verdict, tenantId: parsed.tenantId },
            'observe-mode: would-be non-allow verdict shadowed (not enforced)',
          );
        }
        return {
          verdict: 'allow',
          matchedPolicies: effective.matchedPolicies,
          observedVerdict: effective.verdict,
          enforcementMode: 'observe',
        };
      }

      return { ...effective, observedVerdict: effective.verdict, enforcementMode: 'enforce' };
    },
  };
}
