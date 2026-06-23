/**
 * rules command — List, add, disable, and enable policy rules.
 *
 * Usage:
 *   decision-core rules list
 *   decision-core rules add --name <name> --action-pattern <pattern> --verdict allow|deny|approve_required
 *   decision-core rules disable <name-or-id>
 *   decision-core rules enable <name-or-id>
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { PolicyPackSchema } from '../../sdk/types.js';
import { appendRuleChange, createBackup, decisionCoreDirForPack } from '../backup-utils.js';
import type { CliContext } from '../cli.js';

function resolvePackPath(ctx: CliContext): string | null {
  if (ctx.config?.policyPackPath) return resolve(ctx.config.policyPackPath);
  const auto = resolve(process.cwd(), '.decision-core', 'policy-pack.yaml');
  return existsSync(auto) ? auto : null;
}

export async function rulesCommand(ctx: CliContext): Promise<number> {
  const sub = ctx.args.subcommand;

  switch (sub) {
    case 'list': return rulesList(ctx);
    case 'add': return rulesAdd(ctx);
    case 'disable': return rulesToggle(ctx, false);
    case 'enable': return rulesToggle(ctx, true);
    default:
      ctx.stderr('Usage: decision-core rules <list|add|disable|enable>');
      return 1;
  }
}

function rulesList(ctx: CliContext): number {
  const packPath = resolvePackPath(ctx);
  if (!packPath || !existsSync(packPath)) {
    ctx.stderr('No policy pack found. Run "decision-core init" or "decision-core setup" first.');
    return 1;
  }

  const raw = readFileSync(packPath, 'utf-8');
  const parsed = PolicyPackSchema.parse(parseYaml(raw));

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify(parsed.rules, null, 2));
  } else {
    ctx.stdout(`Rules in ${packPath}:`);
    ctx.stdout('');
    for (const rule of parsed.rules) {
      const verdict = rule.defaultVerdict ?? (rule.requireApproval ? 'approve_required' : 'allow');
      const status = rule.enabled ? '' : ' [DISABLED]';
      ctx.stdout(`  ${rule.name}${status}`);
      ctx.stdout(`    pattern: ${rule.actionTypePattern}  verdict: ${verdict}  priority: ${rule.priority}`);
    }
  }

  return 0;
}

function rulesAdd(ctx: CliContext): number {
  const packPath = resolvePackPath(ctx);
  if (!packPath || !existsSync(packPath)) {
    ctx.stderr('No policy pack found. Run "decision-core init" or "decision-core setup" first.');
    return 1;
  }

  const name = ctx.flags['name'];
  const pattern = ctx.flags['action-pattern'];
  const verdict = ctx.flags['verdict'];

  if (typeof name !== 'string' || typeof pattern !== 'string' || typeof verdict !== 'string') {
    ctx.stderr('Usage: decision-core rules add --name <name> --action-pattern <pattern> --verdict allow|deny|approve_required');
    return 1;
  }

  if (!['allow', 'deny', 'approve_required'].includes(verdict)) {
    ctx.stderr('Verdict must be: allow, deny, or approve_required');
    return 1;
  }

  const raw = readFileSync(packPath, 'utf-8');
  const parsed = parseYaml(raw);
  const pack = PolicyPackSchema.parse(parsed);

  if (pack.rules.some((r) => r.name === name)) {
    ctx.stderr(`Rule "${name}" already exists. Use a different name.`);
    return 1;
  }

  const dcDir = decisionCoreDirForPack(packPath);
  createBackup([packPath], 'rules add', dcDir);

  const newRule: Record<string, unknown> = {
    name,
    actionTypePattern: pattern,
    priority: typeof ctx.flags['priority'] === 'string' ? parseInt(ctx.flags['priority'], 10) : 50,
  };

  if (verdict === 'deny') {
    newRule['defaultVerdict'] = 'deny';
  } else if (verdict === 'approve_required') {
    newRule['requireApproval'] = true;
  }

  parsed.rules = [...(parsed.rules || []), newRule];
  writeFileSync(packPath, stringifyYaml(parsed), 'utf-8');
  appendRuleChange(dcDir, 'rules add', `added ${name} (${verdict}) for ${pattern}`);

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify({ added: name, verdict, pattern }));
  } else {
    ctx.stdout(`Rule "${name}" added — run \`decision-core evaluate --action ${pattern.replace('*', 'test')} --surface api\` to test`);
  }

  return 0;
}

function rulesToggle(ctx: CliContext, enable: boolean): number {
  const packPath = resolvePackPath(ctx);
  if (!packPath || !existsSync(packPath)) {
    ctx.stderr('No policy pack found.');
    return 1;
  }

  const target = ctx.args.positionals[1] ?? ctx.args.positionals[0];
  if (!target) {
    ctx.stderr(`Usage: decision-core rules ${enable ? 'enable' : 'disable'} <name>`);
    return 1;
  }

  const raw = readFileSync(packPath, 'utf-8');
  const parsed = parseYaml(raw);

  const rule = (parsed.rules as Array<{ name: string; enabled?: boolean }>)?.find((r) => r.name === target);
  if (!rule) {
    ctx.stderr(`Rule "${target}" not found.`);
    return 1;
  }

  const dcDir = decisionCoreDirForPack(packPath);
  createBackup([packPath], `rules ${enable ? 'enable' : 'disable'}`, dcDir);

  rule.enabled = enable;
  writeFileSync(packPath, stringifyYaml(parsed), 'utf-8');
  appendRuleChange(dcDir, `rules ${enable ? 'enable' : 'disable'}`, `${enable ? 'enabled' : 'disabled'} ${target}`);

  ctx.stdout(`Rule "${target}" ${enable ? 'enabled' : 'disabled'}.`);
  return 0;
}
