/**
 * enforce command — Promote observe mode → enforce (turn on real blocking).
 *
 * Usage: decision-core enforce [--yes] [--json]
 *
 * Shows what enforcement will block (from the observe-mode observations), then —
 * on explicit confirmation — flips `enforcementMode: observe → enforce` in
 * decision-core.yaml (backup + validate, via the shared flipToEnforce helper).
 * Never touches the policy rules. Refuses when no policy pack is configured.
 */

import type { TenantId } from '../../../contracts/common.contracts.js';
import { createReadline, prompt } from '../readline-helpers.js';
import { aggregateObservations, recommendFromObservations } from '../../../decisions/observations.js';
import { inspectPromote, flipToEnforce } from '../promote-enforce.js';
import type { CliContext } from '../cli.js';

export async function enforceCommand(ctx: CliContext): Promise<number> {
  const cwd = process.cwd();
  const isJson = !!ctx.flags['json'];
  const fail = (msg: string): number => {
    if (isJson) ctx.stdout(JSON.stringify({ enforced: false, error: msg }));
    else ctx.stderr(msg);
    return 1;
  };

  const state = inspectPromote(cwd);
  if (!state.exists) return fail('No decision-core.yaml found. Run `decision-core setup` (or `init`) first.');
  if (!state.valid) return fail('decision-core.yaml is invalid — fix it (or re-run `decision-core setup`) before enforcing.');
  if (state.alreadyEnforcing) {
    if (isJson) ctx.stdout(JSON.stringify({ enforced: true, alreadyEnforcing: true }));
    else ctx.stdout('Already enforcing — enforcementMode is `enforce`. Nothing to do.');
    return 0;
  }
  if (!state.hasPack) return fail('No policy pack configured — refusing to enforce an empty policy. Run `decision-core setup` first.');

  // Load observations so the operator sees the impact before flipping.
  let summary = aggregateObservations([]);
  if (ctx.config?.persistence === 'sqlite' && ctx.config?.sqlitePath) {
    try {
      const { createSqliteConnection } = await import('../../../persistence/sqlite/sqlite-connection.js');
      const { SqliteDecisionLogRepository } = await import('../../../persistence/sqlite/sqlite-decision-log.repository.js');
      const db = createSqliteConnection({ path: ctx.config.sqlitePath });
      const repo = new SqliteDecisionLogRepository(db);
      const records = await repo.findAll((ctx.config.tenantId ?? 'default') as TenantId, { limit: 5000 });
      db.close();
      summary = aggregateObservations(records);
    } catch (err) {
      return fail(`Unable to read observe-mode decision log before enforcing: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const recommendations = recommendFromObservations(summary);

  // JSON without --yes is a non-mutating preview.
  if (isJson && !ctx.flags['yes']) {
    ctx.stdout(JSON.stringify({ enforced: false, preview: true, diff: { enforcementMode: { from: 'observe', to: 'enforce' } }, summary, recommendations }, null, 2));
    return 0;
  }

  if (!isJson) {
    ctx.stdout('Promote to ENFORCE — this turns ON real blocking.');
    ctx.stdout('  Change: enforcementMode  observe -> enforce  (in decision-core.yaml)');
    ctx.stdout(`  Observed while watching: ${summary.totalObservations} would-be denial(s) across ${summary.groups.length} group(s).`);
    for (const r of recommendations.slice(0, 8)) {
      ctx.stdout(`    - ${r.toolName}: ${r.recommendation === 'consider_allowing' ? 'consider allowing' : 'will block'} (${r.count}x)`);
    }
    ctx.stdout('');
  }

  if (!ctx.flags['yes']) {
    const rl = createReadline();
    try {
      const answer = (await prompt(rl, 'Turn on enforcement now? [y/N] ')).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        ctx.stdout('Aborted — still in observe mode.');
        return 0;
      }
    } finally {
      rl.close();
    }
  }

  const result = flipToEnforce(cwd);
  if (!result.ok) return fail(result.error);

  if (isJson) {
    ctx.stdout(JSON.stringify({ enforced: true, from: 'observe', to: 'enforce', observationsReviewed: summary.totalObservations }, null, 2));
  } else {
    ctx.stdout('ENFORCE MODE is now ON — denied actions are blocked and recorded in the audit trail.');
    ctx.stdout('Rollback: set `enforcementMode: observe` in decision-core.yaml (or restore the .decision-core backup).');
  }
  return 0;
}
