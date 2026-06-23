/**
 * upgrade command — Change profile mode and add mode-specific rules.
 *
 * Usage: decision-core upgrade --to team|business|enterprise
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { appendRuleChange, createBackup, decisionCoreDirForPack } from '../backup-utils.js';
import type { CliContext } from '../cli.js';

const MODE_RULES: Record<string, Array<{ name: string; actionTypePattern: string; priority: number; defaultVerdict?: string; requireApproval?: boolean }>> = {
  team: [
    { name: 'team-destructive-approval', actionTypePattern: 'delete_*', priority: 80, requireApproval: true },
  ],
  business: [
    { name: 'business-destructive-approval', actionTypePattern: 'delete_*', priority: 80, requireApproval: true },
    { name: 'business-admin-approval', actionTypePattern: 'admin_*', priority: 85, requireApproval: true },
  ],
  enterprise: [
    { name: 'enterprise-destructive-deny', actionTypePattern: 'delete_*', priority: 90, defaultVerdict: 'deny' },
    { name: 'enterprise-admin-approval', actionTypePattern: 'admin_*', priority: 85, requireApproval: true },
    { name: 'enterprise-deploy-approval', actionTypePattern: 'deploy_*', priority: 85, requireApproval: true },
  ],
};

export async function upgradeCommand(ctx: CliContext): Promise<number> {
  const targetMode = ctx.flags['to'];
  if (typeof targetMode !== 'string' || !['team', 'business', 'enterprise'].includes(targetMode)) {
    ctx.stderr('Usage: decision-core upgrade --to team|business|enterprise');
    return 1;
  }

  const packPath = ctx.config?.policyPackPath
    ? resolve(ctx.config.policyPackPath)
    : resolve(process.cwd(), '.decision-core', 'policy-pack.yaml');

  if (!existsSync(packPath)) {
    ctx.stderr('No policy pack found. Run "decision-core init" first.');
    return 1;
  }

  const raw = readFileSync(packPath, 'utf-8');
  const parsed = parseYaml(raw);

  const dcDir = decisionCoreDirForPack(packPath);
  createBackup([packPath], `upgrade --to ${targetMode}`, dcDir);

  const existingNames = new Set((parsed.rules as Array<{ name: string }>).map((r) => r.name));
  const newRules = (MODE_RULES[targetMode] ?? []).filter((r) => !existingNames.has(r.name));

  if (newRules.length === 0) {
    ctx.stdout(`Already at or above ${targetMode} mode — no new rules needed.`);
    return 0;
  }

  parsed.rules = [...(parsed.rules || []), ...newRules];
  writeFileSync(packPath, stringifyYaml(parsed), 'utf-8');
  appendRuleChange(dcDir, `upgrade --to ${targetMode}`, `added ${newRules.length} mode rule(s): ${newRules.map((r) => r.name).join(', ')}`);

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify({ mode: targetMode, added: newRules.map((r) => r.name) }));
  } else {
    ctx.stdout(`Upgraded to ${targetMode} mode. Added ${newRules.length} rule(s):`);
    for (const r of newRules) {
      ctx.stdout(`  ${r.name}`);
    }
    ctx.stdout('Existing custom rules were preserved.');
  }

  return 0;
}
