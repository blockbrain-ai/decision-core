import { loadAgentRegistry } from './agent-registry.js';
import { loadAccessPolicy, getAccessMatrix } from './access-policy-loader.js';

export interface OrgReport {
  generatedAt: string;
  agents: Array<{
    agentId: string;
    displayName: string;
    humanOwner?: string;
    roles: string[];
    enabled: boolean;
    personalBrain?: string;
  }>;
  accessMatrix: Record<string, string[]>;
  classifications: Array<{
    name: string;
    brain: string;
    accessibleBy: string[];
    neverAccessibleBy: string[];
  }>;
  warnings: string[];
}

export function generateOrgReport(
  agentRegistryPath: string,
  accessPolicyPath: string,
): OrgReport {
  const registry = loadAgentRegistry(agentRegistryPath);
  const policy = loadAccessPolicy(accessPolicyPath);

  const matrix = getAccessMatrix(policy);
  const accessMatrixObj: Record<string, string[]> = {};
  for (const [role, brains] of matrix) {
    accessMatrixObj[role] = brains;
  }

  const warnings: string[] = [];

  const rolesInRegistry = new Set<string>();
  for (const agent of registry.agents) {
    for (const r of agent.roles) rolesInRegistry.add(r);
  }

  for (const classification of policy.classifications) {
    for (const role of classification.accessibleBy) {
      if (role === '{self}') continue;
      if (!rolesInRegistry.has(role)) {
        warnings.push(`Role "${role}" in access-policy classification "${classification.name}" not found in any agent`);
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    agents: registry.agents.map((a) => ({
      agentId: a.agentId,
      displayName: a.displayName,
      humanOwner: a.humanOwner,
      roles: a.roles,
      enabled: a.enabled,
      personalBrain: a.personalBrain,
    })),
    accessMatrix: accessMatrixObj,
    classifications: policy.classifications.map((c) => ({
      name: c.name,
      brain: c.brain,
      accessibleBy: c.accessibleBy,
      neverAccessibleBy: c.neverAccessibleBy,
    })),
    warnings,
  };
}

export function formatReportMarkdown(report: OrgReport): string {
  const lines: string[] = [
    '# Organisation Status Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Agents',
    '',
    '| Agent ID | Display Name | Owner | Roles | Enabled | Personal Brain |',
    '|----------|-------------|-------|-------|---------|---------------|',
  ];

  for (const a of report.agents) {
    lines.push(
      `| ${a.agentId} | ${a.displayName} | ${a.humanOwner ?? '-'} | ${a.roles.join(', ')} | ${a.enabled ? 'Yes' : 'No'} | ${a.personalBrain ?? '-'} |`,
    );
  }

  lines.push('', '## Access Matrix', '', '| Role | Authorised Brains |', '|------|------------------|');

  for (const [role, brains] of Object.entries(report.accessMatrix)) {
    lines.push(`| ${role} | ${brains.join(', ') || 'none'} |`);
  }

  lines.push('', '## Classifications', '', '| Name | Brain | Accessible By | Never Accessible By |', '|------|-------|--------------|-------------------|');

  for (const c of report.classifications) {
    lines.push(
      `| ${c.name} | ${c.brain} | ${c.accessibleBy.join(', ')} | ${c.neverAccessibleBy.join(', ') || '-'} |`,
    );
  }

  if (report.warnings.length > 0) {
    lines.push('', '## Warnings', '');
    for (const w of report.warnings) {
      lines.push(`- ${w}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function formatReportJson(report: OrgReport): string {
  return JSON.stringify(report, null, 2);
}
