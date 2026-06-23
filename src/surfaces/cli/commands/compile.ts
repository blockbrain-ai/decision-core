/**
 * compile command — Compile approved clauses into enforcement rules.
 *
 * Usage: decision-core compile --clause-ids <id1,id2,...>
 */

import { createPolicyRuleCompiler, type ControlProvider } from '../../../knowledge/compiler/policy-rule-compiler.service.js';
import { InMemoryClauseRepository } from '../../../persistence/memory/in-memory-clause.repository.js';
import type { TenantId } from '../../../contracts/common.contracts.js';
import type { CliContext } from '../cli.js';

export async function compileCommand(ctx: CliContext): Promise<number> {
  const clauseIdsRaw = typeof ctx.flags['clause-ids'] === 'string' ? ctx.flags['clause-ids'] : undefined;

  if (!clauseIdsRaw) {
    ctx.stderr('Usage: decision-core compile --clause-ids <id1,id2,...>');
    ctx.stderr('  Compiles approved clauses into deterministic enforcement rules.');
    return 1;
  }

  const clauseIds = clauseIdsRaw.split(',').map(s => s.trim());
  const tenantId = (ctx.config?.tenantId ?? 'default') as unknown as TenantId;

  const clauseRepo = new InMemoryClauseRepository();
  // Control provider: returns empty controls for CLI usage (clauses compile by type alone)
  const controlProvider: ControlProvider = {
    findByClauseId: async () => [],
  };

  const compiler = createPolicyRuleCompiler(clauseRepo, controlProvider);
  const result = await compiler.compile(tenantId, clauseIds);

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify(result, null, 2));
  } else {
    ctx.stdout(`Compilation complete:`);
    ctx.stdout(`  Compiled rules: ${result.compiledRules.length}`);
    ctx.stdout(`  Ambiguous clauses: ${result.ambiguousClauses.length}`);
    ctx.stdout(`  Errors: ${result.errors.length}`);

    if (result.compiledRules.length > 0) {
      ctx.stdout('\nRules:');
      for (const rule of result.compiledRules) {
        ctx.stdout(`  [${rule.ruleType}] ${rule.clauseId} — ${rule.description}`);
      }
    }

    if (result.ambiguousClauses.length > 0) {
      ctx.stdout('\nAmbiguous:');
      for (const amb of result.ambiguousClauses) {
        ctx.stdout(`  ${amb.clauseId}: ${amb.reason}`);
      }
    }

    if (result.errors.length > 0) {
      ctx.stdout('\nErrors:');
      for (const err of result.errors) {
        ctx.stdout(`  ${err.clauseId}: ${err.error}`);
      }
    }
  }

  return 0;
}
