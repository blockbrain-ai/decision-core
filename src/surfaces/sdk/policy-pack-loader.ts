import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { PolicyRule, PolicyRuleCreateInput } from '../../contracts/policy.contracts.js';
import type { PolicyRuleRepository } from '../../persistence/interfaces/policy-rule.repository.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import { PolicyPackSchema, type PolicyPack, type PolicyPackRule } from './types.js';
import { loadPackAsRules, type PackLoadResult } from '../../packs/pack-loader.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('policy-pack-loader');

export function loadPolicyPack(filePath: string): PolicyPack {
  const content = readFileSync(filePath, 'utf-8');
  return parsePolicyPackYaml(content);
}

export function parsePolicyPackYaml(yamlContent: string): PolicyPack {
  const raw = parseYaml(yamlContent);
  return PolicyPackSchema.parse(raw);
}

export function policyPackToRules(pack: PolicyPack): PolicyRuleCreateInput[] {
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

export interface SeedResult {
  rules: PolicyRule[];
  denyUnknownDefault: boolean;
}

export async function loadAndSeedPolicyPack(
  filePath: string,
  tenantId: string,
  repository: PolicyRuleRepository,
): Promise<SeedResult> {
  const packResult: PackLoadResult = loadPackAsRules(filePath);

  logger.info(
    { filePath, tenantId, ruleCount: packResult.rules.length, packName: packResult.packName, format: packResult.sourceFormat },
    'Seeding policy rules from pack',
  );

  const seeded: PolicyRule[] = [];
  for (const input of packResult.rules) {
    const created = await repository.create(tenantId as TenantId, input);
    seeded.push(created);
  }

  return { rules: seeded, denyUnknownDefault: packResult.denyUnknownDefault };
}
