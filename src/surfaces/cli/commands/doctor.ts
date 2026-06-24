/**
 * doctor command — Verify install, config, pack, and evaluate health.
 *
 * Usage: decision-core doctor [--json]
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { CliConfigSchema } from '../config-loader.js';
import { loadPackAsRules } from '../../../packs/pack-loader.js';
import { createPolicyGuard } from '../../sdk/create-policy-guard.js';
import type { CliContext } from '../cli.js';

interface Check {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

export async function doctorCommand(ctx: CliContext): Promise<number> {
  const checks: Check[] = [];
  const cwd = process.cwd();

  // Check 1: Config found
  const configPath = resolve(cwd, 'decision-core.yaml');
  const autoPackPath = resolve(cwd, '.decision-core', 'policy-pack.yaml');

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = parseYaml(raw);
      const result = CliConfigSchema.safeParse(parsed);
      if (result.success) {
        checks.push({ name: 'config', status: 'pass', message: 'decision-core.yaml found and valid' });
      } else {
        checks.push({ name: 'config', status: 'fail', message: `decision-core.yaml invalid: ${result.error.message}` });
      }
    } catch (err) {
      checks.push({ name: 'config', status: 'fail', message: `Cannot read decision-core.yaml: ${err instanceof Error ? err.message : String(err)}` });
    }
  } else if (existsSync(autoPackPath)) {
    checks.push({ name: 'config', status: 'pass', message: 'Auto-discovered .decision-core/policy-pack.yaml (no decision-core.yaml)' });
  } else {
    checks.push({ name: 'config', status: 'fail', message: 'No decision-core.yaml or .decision-core/policy-pack.yaml found. Run "decision-core init".' });
  }

  // Check 2: Policy pack loads
  const packPath = ctx.config?.policyPackPath
    ? resolve(ctx.config.policyPackPath)
    : existsSync(autoPackPath) ? autoPackPath : null;

  let packPatterns: string[] = [];
  if (packPath && existsSync(packPath)) {
    try {
      const result = loadPackAsRules(packPath);
      packPatterns = result.rules.map((r) => r.actionTypePattern);
      const denyRules = result.rules.filter((r) => r.defaultVerdict === 'deny');
      const approvalRules = result.rules.filter((r) => r.requireApproval);
      checks.push({
        name: 'pack',
        status: 'pass',
        message: `Policy pack loaded: ${result.rules.length} rules (${denyRules.length} deny, ${approvalRules.length} approval, ${result.sourceFormat})`,
      });
    } catch (err) {
      checks.push({ name: 'pack', status: 'fail', message: `Cannot parse policy pack: ${err instanceof Error ? err.message : String(err)}` });
    }
  } else {
    checks.push({ name: 'pack', status: 'fail', message: 'No policy pack file found' });
  }

  // Check 3: denyUnknownDefault
  if (packPath && existsSync(packPath)) {
    try {
      const loaded = loadPackAsRules(packPath);
      if (loaded.denyUnknownDefault) {
        checks.push({ name: 'deny-unknown', status: 'pass', message: 'denyUnknownDefault is enabled — unknown actions will be denied' });
      } else {
        checks.push({ name: 'deny-unknown', status: 'warn', message: 'denyUnknownDefault is disabled — unknown actions will be allowed' });
      }
    } catch {
      // Already reported in pack check
    }
  }

  // Check 4: No secrets in pack
  if (packPath && existsSync(packPath)) {
    const content = readFileSync(packPath, 'utf-8');
    if (/sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer [A-Za-z0-9._-]{20,}/.test(content)) {
      checks.push({ name: 'secrets', status: 'fail', message: 'API key pattern detected in policy pack!' });
    } else {
      checks.push({ name: 'secrets', status: 'pass', message: 'No secret patterns detected in policy pack' });
    }
  }

  // Check 5: unknown-action behavior
  if (packPath && existsSync(packPath)) {
    try {
      const guard = await createPolicyGuard({
        tenantId: ctx.config?.tenantId ?? 'default',
        policyPackPath: packPath,
        denyUnknownDefault: ctx.config?.denyUnknownDefault,
      });
      const verdict = await guard.evaluate(ctx.config?.tenantId ?? 'default', 'doctor', '__decision_core_unknown_doctor_check__');
      const loaded = loadPackAsRules(packPath);
      if (loaded.denyUnknownDefault || ctx.config?.denyUnknownDefault) {
        checks.push(verdict.verdict === 'deny'
          ? { name: 'unknown-action', status: 'pass', message: 'Unknown actions deny as configured' }
          : { name: 'unknown-action', status: 'fail', message: `Unknown action returned ${verdict.verdict}, expected deny` });
      } else {
        checks.push({ name: 'unknown-action', status: 'warn', message: `Unknown action returned ${verdict.verdict}; enable denyUnknownDefault for stricter setup` });
      }
    } catch (err) {
      checks.push({ name: 'unknown-action', status: 'fail', message: `Cannot evaluate unknown-action behavior: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  // Check 6: SQLite writable (if configured)
  if (ctx.config?.persistence === 'sqlite' && ctx.config?.sqlitePath) {
    try {
      const { createSqliteConnection } = await import('../../../persistence/sqlite/sqlite-connection.js');
      const db = createSqliteConnection({ path: ctx.config.sqlitePath });
      db.close();
      checks.push({ name: 'sqlite', status: 'pass', message: `SQLite file writable: ${ctx.config.sqlitePath}` });
    } catch (err) {
      checks.push({ name: 'sqlite', status: 'fail', message: `SQLite not writable: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  // Check 6b: Policy drift (E3) — detected tools that no rule governs.
  if (packPatterns.length > 0) {
    try {
      const { detectAgentEnvironment } = await import('../../../onboarding/detect-agent-env.js');
      const { findUngovernedTools } = await import('../../../onboarding/rule-proposal.js');
      const detected = detectAgentEnvironment(cwd).tools.map((t) => t.name);
      const ungoverned = findUngovernedTools(detected, packPatterns);
      if (ungoverned.length > 0) {
        checks.push({
          name: 'drift',
          status: 'warn',
          message: `${ungoverned.length} detected tool(s) have no matching rule (e.g. ${ungoverned.slice(0, 3).join(', ')}). Run \`decision-core rescan\` (or your agent's dc_propose_rule).`,
        });
      } else {
        checks.push({ name: 'drift', status: 'pass', message: 'All detected tools are governed by a rule' });
      }
    } catch {
      // Drift detection is best-effort — never fail doctor on it.
    }
  }

  // Check 7: Enforcement mode — make the observe/enforce state + next action visible.
  const mode = ctx.config?.enforcementMode ?? 'enforce';
  if (mode === 'observe') {
    checks.push({
      name: 'mode',
      status: 'warn',
      message: 'OBSERVE MODE active — watching, not blocking. Review: `decision-core observations`; enforce: `decision-core enforce`',
    });
  } else {
    checks.push({ name: 'mode', status: 'pass', message: 'ENFORCE MODE active — denied actions are blocked' });
  }

  // Output
  const hasFailure = checks.some((c) => c.status === 'fail');

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify({ checks, healthy: !hasFailure }, null, 2));
  } else {
    for (const check of checks) {
      const icon = check.status === 'pass' ? 'OK' : check.status === 'warn' ? 'WARN' : 'FAIL';
      ctx.stdout(`  [${icon}] ${check.name}: ${check.message}`);
    }
    ctx.stdout('');
    ctx.stdout(hasFailure ? 'Some checks failed.' : 'All checks passed.');
  }

  return hasFailure ? 1 : 0;
}
