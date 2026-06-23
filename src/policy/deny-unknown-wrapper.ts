import type { PolicyDecisionPoint } from './policy-decision-point.js';

export function wrapPdpDenyUnknown(inner: PolicyDecisionPoint): PolicyDecisionPoint {
  return {
    evaluate: async (tenantId, context, correlationId) => {
      const result = await inner.evaluate(tenantId, context, correlationId);
      if (result.verdict === 'allow' && result.matchedPolicies.length === 0) {
        return {
          verdict: 'deny',
          matchedPolicies: [{
            ruleId: 'deny-unknown',
            ruleName: 'deny-unknown-default',
            verdict: 'deny',
            reason: 'No policy rules matched — unknown actions denied by default',
          }],
        };
      }
      return result;
    },
    getAuditService: () => inner.getAuditService(),
  } as PolicyDecisionPoint;
}
