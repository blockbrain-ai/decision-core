import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { AccessPolicyConfigSchema, type AccessPolicyConfig } from './access-policy.contracts.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('access-policy');

export function loadAccessPolicy(path?: string): AccessPolicyConfig {
  const resolvedPath = resolve(path ?? '.decision-core/access-policy.yaml');

  if (!existsSync(resolvedPath)) {
    throw new Error(`Access policy not found: ${resolvedPath}`);
  }

  const raw = readFileSync(resolvedPath, 'utf-8');
  const parsed = parseYaml(raw);
  const config = AccessPolicyConfigSchema.parse(parsed);

  logger.info(
    { path: resolvedPath, classificationCount: config.classifications.length },
    'Access policy loaded',
  );

  return config;
}

export function tryLoadAccessPolicy(path?: string): AccessPolicyConfig | null {
  try {
    return loadAccessPolicy(path);
  } catch {
    return null;
  }
}

export function getAuthorisedBrains(policy: AccessPolicyConfig, role: string): string[] {
  const brains: string[] = [];

  for (const classification of policy.classifications) {
    if (classification.neverAccessibleBy.includes(role)) continue;
    if (classification.accessibleBy.includes(role) || classification.accessibleBy.includes('{self}')) {
      brains.push(classification.brain);
    }
  }

  return brains;
}

export function canAccess(policy: AccessPolicyConfig, role: string, classificationName: string): boolean {
  const classification = policy.classifications.find((c) => c.name === classificationName);
  if (!classification) return false;
  if (classification.neverAccessibleBy.includes(role)) return false;
  return classification.accessibleBy.includes(role);
}

export function getAccessMatrix(policy: AccessPolicyConfig): Map<string, string[]> {
  const allRoles = new Set<string>();
  for (const c of policy.classifications) {
    for (const r of c.accessibleBy) allRoles.add(r);
    for (const r of c.neverAccessibleBy) allRoles.add(r);
    for (const r of c.writeAccess) allRoles.add(r);
  }

  const matrix = new Map<string, string[]>();
  for (const role of allRoles) {
    if (role === '{self}') continue;
    matrix.set(role, getAuthorisedBrains(policy, role));
  }

  return matrix;
}

export interface AccessViolation {
  agentId: string;
  role: string;
  brain: string;
  classification: string;
  reason: string;
}

export function verifyMounts(
  policy: AccessPolicyConfig,
  agentMounts: Array<{ agentId: string; roles: string[]; mountedBrains: string[] }>,
): AccessViolation[] {
  const violations: AccessViolation[] = [];

  for (const agent of agentMounts) {
    for (const brain of agent.mountedBrains) {
      const classification = policy.classifications.find((c) => c.brain === brain);
      if (!classification) continue;

      const hasAccess = agent.roles.some((role) => {
        if (classification.neverAccessibleBy.includes(role)) return false;
        return classification.accessibleBy.includes(role);
      });

      if (!hasAccess) {
        const blockingRole = agent.roles.find((r) => classification.neverAccessibleBy.includes(r));
        violations.push({
          agentId: agent.agentId,
          role: blockingRole ?? agent.roles[0],
          brain,
          classification: classification.name,
          reason: blockingRole
            ? `Role "${blockingRole}" is in neverAccessibleBy for classification "${classification.name}"`
            : `No role in [${agent.roles.join(', ')}] has access to classification "${classification.name}"`,
        });
      }
    }
  }

  return violations;
}
