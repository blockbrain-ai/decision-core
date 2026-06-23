/**
 * init command — Create a starter decision-core.yaml and optional policy pack.
 *
 * Usage: decision-core init [--profile personal|team|business|enterprise] [--allow-unknown]
 */

import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { stringify as stringifyYaml } from 'yaml';
import { createBackup } from '../backup-utils.js';
import type { CliContext } from '../cli.js';

export async function initCommand(ctx: CliContext): Promise<number> {
  const cwd = process.cwd();
  const configPath = resolve(cwd, 'decision-core.yaml');

  if (existsSync(configPath)) {
    ctx.stderr('decision-core.yaml already exists. Use --force to overwrite.');
    if (!ctx.flags['force']) return 1;
  }

  const profileFlag = ctx.flags['profile'];
  const profile = typeof profileFlag === 'string' ? profileFlag : 'personal';
  const validProfiles = ['personal', 'team', 'business', 'enterprise'];
  if (!validProfiles.includes(profile)) {
    ctx.stderr(`Invalid profile "${profile}". Available: ${validProfiles.join(', ')}`);
    return 1;
  }

  const denyUnknown = !ctx.flags['allow-unknown'];

  const dcDir = resolve(cwd, '.decision-core');
  mkdirSync(dcDir, { recursive: true });
  const packPath = resolve(dcDir, 'policy-pack.yaml');

  if (ctx.flags['force']) {
    createBackup([configPath, packPath], 'init --force', dcDir);
  }

  const packRules = generateStarterRules(profile, denyUnknown);
  const packYaml = stringifyYaml({
    version: '1.0.0',
    name: `${profile}-starter`,
    denyUnknownDefault: denyUnknown,
    rules: packRules,
  });

  writeFileSync(packPath, packYaml, 'utf-8');

  const configYaml = stringifyYaml({
    tenantId: 'default',
    persistence: 'memory',
    tenantMode: 'single',
    policyPackPath: '.decision-core/policy-pack.yaml',
    denyUnknownDefault: denyUnknown,
  });

  writeFileSync(configPath, configYaml, 'utf-8');

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify({
      configPath,
      packPath,
      profile,
      denyUnknownDefault: denyUnknown,
    }));
  } else {
    ctx.stdout(`Created decision-core.yaml (profile: ${profile})`);
    ctx.stdout(`Created .decision-core/policy-pack.yaml`);
    if (denyUnknown) {
      ctx.stdout('Unknown actions will be denied by default. Pass --allow-unknown to change.');
    }
    ctx.stdout('');
    ctx.stdout('Next steps:');
    ctx.stdout('  decision-core evaluate --surface api --action read_file');
    ctx.stdout('  decision-core doctor');
  }

  return 0;
}

interface StarterRule {
  name: string;
  description: string;
  actionTypePattern: string;
  priority: number;
  requireApproval?: boolean;
  defaultVerdict?: string;
}

function generateStarterRules(profile: string, _denyUnknown: boolean): StarterRule[] {
  const rules: StarterRule[] = [
    {
      name: 'allow-read',
      description: 'Allow read/list/get/search operations',
      actionTypePattern: 'read_*',
      priority: 50,
    },
    {
      name: 'allow-list',
      description: 'Allow list operations',
      actionTypePattern: 'list_*',
      priority: 50,
    },
    {
      name: 'allow-get',
      description: 'Allow get operations',
      actionTypePattern: 'get_*',
      priority: 50,
    },
    {
      name: 'allow-search',
      description: 'Allow search operations',
      actionTypePattern: 'search_*',
      priority: 50,
    },
  ];

  if (profile === 'team' || profile === 'business') {
    rules.push({
      name: 'approve-destructive',
      description: 'Destructive operations require approval',
      actionTypePattern: 'delete_*',
      priority: 80,
      requireApproval: true,
    });
  }

  if (profile === 'enterprise') {
    rules.push(
      {
        name: 'deny-destructive',
        description: 'Deny destructive operations',
        actionTypePattern: 'delete_*',
        priority: 90,
        defaultVerdict: 'deny',
      },
      {
        name: 'approve-admin',
        description: 'Admin operations require approval',
        actionTypePattern: 'admin_*',
        priority: 85,
        requireApproval: true,
      },
    );
  }

  return rules;
}
