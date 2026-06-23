/**
 * evaluate command — Evaluate a decision against policies.
 *
 * Usage: decision-core evaluate --surface <id> --action <action> [--context '{"key":"val"}']
 */

import { evaluate } from '../../sdk/evaluate.js';
import type { CliContext } from '../cli.js';

export async function evaluateCommand(ctx: CliContext): Promise<number> {
  const surface = ctx.flags['surface'];
  const action = ctx.flags['action'];

  if (typeof surface !== 'string' || typeof action !== 'string') {
    ctx.stderr('Usage: decision-core evaluate --surface <id> --action <action> [--context \'{"key":"val"}\']');
    return 1;
  }

  // Parse context from --context flag or key=value positionals
  const context = parseContext(ctx);

  const persistenceFlag = ctx.flags['persistence'];
  const sqlitePathFlag = ctx.flags['sqlite-path'];
  const result = await evaluate(
    { action, surface, context },
    {
      tenantId: ctx.config?.tenantId ?? 'default',
      policyPackPath: ctx.config?.policyPackPath,
      denyUnknownDefault: ctx.config?.denyUnknownDefault,
      persistence: persistenceFlag === 'sqlite' ? 'sqlite' : ctx.config?.persistence === 'sqlite' ? 'sqlite' : undefined,
      sqlitePath: typeof sqlitePathFlag === 'string' ? sqlitePathFlag : ctx.config?.sqlitePath,
    },
  );

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify({
      verdict: result.decision,
      matchedPolicies: result.matchedPolicies,
      rationale: result.rationale,
      correlationId: result.correlationId,
    }, null, 2));
  } else {
    ctx.stdout(`Verdict: ${result.decision}`);
    ctx.stdout(`Correlation ID: ${result.correlationId}`);
    if (result.matchedPolicies.length > 0) {
      ctx.stdout(`Matched policies:`);
      for (const mp of result.matchedPolicies) {
        ctx.stdout(`  [${mp.verdict}] ${mp.ruleName}: ${mp.reason}`);
      }
    }
  }

  return 0;
}

function parseContext(ctx: CliContext): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Parse key=value from positionals
  for (const pos of ctx.args.positionals) {
    if (pos.includes('=')) {
      const eqIdx = pos.indexOf('=');
      const key = pos.slice(0, eqIdx);
      const val = pos.slice(eqIdx + 1);
      result[key] = tryParseValue(val);
    }
  }

  // Parse --context as JSON string if provided
  const contextFlag = ctx.flags['context'];
  if (typeof contextFlag === 'string') {
    try {
      const parsed = JSON.parse(contextFlag);
      Object.assign(result, parsed);
    } catch {
      // Treat as key=value format
      if (contextFlag.includes('=')) {
        const eqIdx = contextFlag.indexOf('=');
        result[contextFlag.slice(0, eqIdx)] = tryParseValue(contextFlag.slice(eqIdx + 1));
      }
    }
  }

  return result;
}

function tryParseValue(val: string): unknown {
  if (val === 'true') return true;
  if (val === 'false') return false;
  const num = Number(val);
  if (!isNaN(num) && val.length > 0) return num;
  return val;
}
