import type { PolicyPack as ContractsPolicyPack } from '../contracts/policy-pack.contracts.js';
import type { PolicyPack as SdkPolicyPack, PolicyPackRule } from '../surfaces/sdk/types.js';
import type { PolicyRuleCreateInput, VerdictResult } from '../contracts/policy.contracts.js';

export function contractsPackToRules(pack: ContractsPolicyPack): PolicyRuleCreateInput[] {
  const rules: PolicyRuleCreateInput[] = [];

  for (const packRule of pack.rules) {
    const tools = packRule.tools ?? ['*'];

    for (const toolPattern of tools) {
      const defaultVerdict: VerdictResult | undefined =
        packRule.action === 'deny' ? 'deny'
          : packRule.action === 'approve_required' ? 'approve_required'
            : undefined;

      rules.push({
        name: packRule.name,
        description: packRule.description ?? '',
        actionTypePattern: toolPattern,
        riskClass: 'B',
        enforcementPoint: 'pre_decision',
        policyType: 'business',
        priority: packRule.priority,
        maxAmountUsd: packRule.conditions?.maxAmountUsd,
        maxCountPerDay: packRule.conditions?.maxCountPerDay,
        cooldownMinutes: packRule.conditions?.cooldownMinutes,
        timeWindowStart: packRule.conditions?.timeWindowStart,
        timeWindowEnd: packRule.conditions?.timeWindowEnd,
        requireApproval: packRule.action === 'approve_required',
        defaultVerdict,
        enabled: true,
      });
    }
  }

  return rules;
}

export function sdkPackToRules(pack: SdkPolicyPack): PolicyRuleCreateInput[] {
  return pack.rules.map((rule: PolicyPackRule) => ({
    name: rule.name,
    description: rule.description,
    actionTypePattern: rule.actionTypePattern,
    riskClass: rule.riskClass,
    enforcementPoint: rule.enforcementPoint,
    policyType: rule.policyType,
    priority: rule.priority,
    maxAmountUsd: rule.maxAmountUsd,
    maxCountPerDay: rule.maxCountPerDay,
    cooldownMinutes: rule.cooldownMinutes,
    timeWindowStart: rule.timeWindowStart,
    timeWindowEnd: rule.timeWindowEnd,
    minDataQuality: rule.minDataQuality,
    minConfidence: rule.minConfidence,
    requiredConstraints: rule.requiredConstraints,
    requireApproval: rule.requireApproval,
    defaultVerdict: rule.defaultVerdict,
    requiredRoles: rule.requiredRoles,
    roleMatchMode: rule.roleMatchMode,
    approverRole: rule.approverRole,
    enabled: rule.enabled,
  }));
}
