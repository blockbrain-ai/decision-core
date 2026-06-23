/**
 * rescan command — Detect new tools and compare against existing policy rules.
 *
 * Usage:
 *   decision-core rescan [--apply] [--deny-new]
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { detectAgentEnvironment } from '../../../onboarding/detect-agent-env.js';
import { classifyDetectedTools } from '../../../onboarding/tool-risk-classifier.js';
import { globMatches } from '../../../policy/glob-matcher.js';
import { PolicyPackSchema } from '../../sdk/types.js';
import { appendRuleChange, createBackup, decisionCoreDirForPack } from '../backup-utils.js';
import type { CliContext } from '../cli.js';

export async function rescanCommand(ctx: CliContext): Promise<number> {
  const cwd = process.cwd();
  const packPath = ctx.config?.policyPackPath
    ? resolve(ctx.config.policyPackPath)
    : resolve(cwd, '.decision-core', 'policy-pack.yaml');

  if (!existsSync(packPath)) {
    ctx.stderr('No policy pack found. Run "decision-core init" or "decision-core setup" first.');
    return 1;
  }

  const env = detectAgentEnvironment(cwd);
  const detectedToolNames = env.tools.map((t) => t.name);

  const raw = readFileSync(packPath, 'utf-8');
  const parsed = parseYaml(raw);
  const pack = PolicyPackSchema.parse(parsed);

  const existingPatterns = pack.rules.map((r) => r.actionTypePattern);
  const newTools = detectedToolNames.filter((name) => {
    return !existingPatterns.some((pattern) => globMatches(pattern, name));
  });

  if (newTools.length === 0) {
    if (ctx.flags['json']) {
      ctx.stdout(JSON.stringify({ newTools: [], message: 'All detected tools have matching rules.' }));
    } else {
      ctx.stdout('All detected tools have matching rules. No changes needed.');
    }
    return 0;
  }

  const candidates = classifyDetectedTools(newTools);

  if (!ctx.flags['apply']) {
    if (ctx.flags['json']) {
      ctx.stdout(JSON.stringify({ newTools: candidates }));
    } else {
      ctx.stdout(`Found ${newTools.length} new tool(s) without matching rules:`);
      ctx.stdout('');
      for (const c of candidates) {
        ctx.stdout(`  ${c.name} — risk tier ${c.riskTier}, suggested: ${c.defaultAction}`);
      }
      ctx.stdout('');
      ctx.stdout('Run with --apply to add conservative rules, or --apply --deny-new to deny all new tools.');
    }
    return 0;
  }

  const dcDir = decisionCoreDirForPack(packPath);
  createBackup([packPath], 'rescan --apply', dcDir);

  const denyNew = !!ctx.flags['deny-new'];
  const newRules: Array<Record<string, unknown>> = [];

  for (const c of candidates) {
    const rule: Record<string, unknown> = {
      name: `auto-${c.name}`,
      description: `Auto-detected tool: ${c.name}`,
      actionTypePattern: c.name,
      priority: 50,
    };

    if (denyNew || c.riskTier >= 4) {
      rule['defaultVerdict'] = 'deny';
      rule['priority'] = 90;
    } else if (c.riskTier >= 2) {
      rule['requireApproval'] = true;
      rule['priority'] = 70;
    }

    newRules.push(rule);
  }

  parsed.rules = [...(parsed.rules || []), ...newRules];
  writeFileSync(packPath, stringifyYaml(parsed), 'utf-8');
  appendRuleChange(dcDir, 'rescan --apply', `added ${newRules.length} rule(s): ${newRules.map((r) => r['name']).join(', ')}`);

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify({ added: newRules.map((r) => r['name']) }));
  } else {
    ctx.stdout(`Added ${newRules.length} rule(s) for newly detected tools:`);
    for (const r of newRules) {
      const verdict = r['defaultVerdict'] ?? (r['requireApproval'] ? 'approve_required' : 'allow');
      ctx.stdout(`  ${r['name']} → ${verdict}`);
    }
  }

  return 0;
}
