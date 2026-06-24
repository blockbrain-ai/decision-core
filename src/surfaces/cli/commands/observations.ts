/**
 * observations command — Review what observe mode WOULD have blocked.
 *
 * Usage: decision-core observations [--since <iso>] [--limit <n>] [--json]
 *
 * Observe mode is non-blocking: it records would-be denials instead of enforcing
 * them. This aggregates those recordings (redacted — no tool arguments) so you can
 * see the impact before flipping to enforcement with `decision-core enforce`.
 */

import type { TenantId } from '../../../contracts/common.contracts.js';
import type { CliContext } from '../cli.js';
import { aggregateObservations, recommendFromObservations } from '../../../decisions/observations.js';

export async function observationsCommand(ctx: CliContext): Promise<number> {
  if (ctx.config?.persistence !== 'sqlite' || !ctx.config?.sqlitePath) {
    const msg = 'Observations require SQLite persistence (the observe-mode decision log).';
    if (ctx.flags['json']) {
      ctx.stdout(JSON.stringify({ error: msg, totalObservations: 0, groups: [] }));
    } else {
      ctx.stderr(msg);
      ctx.stderr('Run `decision-core setup` (observe mode persists by default), or set persistence: sqlite + sqlitePath in decision-core.yaml.');
    }
    return 1;
  }

  try {
    const { createSqliteConnection } = await import('../../../persistence/sqlite/sqlite-connection.js');
    const { SqliteDecisionLogRepository } = await import('../../../persistence/sqlite/sqlite-decision-log.repository.js');

    const db = createSqliteConnection({ path: ctx.config.sqlitePath });
    const repo = new SqliteDecisionLogRepository(db);
    const tenantId = (ctx.config.tenantId ?? 'default') as TenantId;
    const since = typeof ctx.flags['since'] === 'string' ? ctx.flags['since'] : undefined;
    const limit = typeof ctx.flags['limit'] === 'string' ? parseInt(ctx.flags['limit'], 10) : 1000;

    const records = await repo.findAll(tenantId, { from: since, limit });
    db.close();

    const summary = aggregateObservations(records);
    const wantRecommend = !!ctx.flags['recommend'];
    const recommendations = wantRecommend ? recommendFromObservations(summary) : undefined;

    if (ctx.flags['json']) {
      ctx.stdout(JSON.stringify(recommendations ? { ...summary, recommendations } : summary, null, 2));
    } else if (summary.totalObservations === 0) {
      ctx.stdout(`No would-be denials observed yet (scanned ${summary.observeRecordsScanned} observe-mode decision(s)).`);
      ctx.stdout('Decision Core is watching, not blocking. Use your agent normally, then re-run this.');
    } else {
      ctx.stdout(`Observe mode: ${summary.totalObservations} would-be denial(s) across ${summary.groups.length} group(s) — NOT blocked.`);
      ctx.stdout('');
      for (const g of summary.groups) {
        const rules = g.matchedRules.map((r) => r.ruleName).join(', ') || 'deny-unknown';
        ctx.stdout(`  ${g.count}x  ${g.toolName}  -> would ${g.observedVerdict}   [rules: ${rules}]`);
        ctx.stdout(`        first ${g.firstSeen}  last ${g.lastSeen}`);
      }
      if (recommendations) {
        ctx.stdout('');
        ctx.stdout('Recommendations:');
        for (const r of recommendations) {
          const tag = r.recommendation === 'consider_allowing' ? 'CONSIDER ALLOW' : 'KEEP BLOCKING';
          ctx.stdout(`  [${tag}] ${r.toolName} — ${r.rationale}`);
        }
      }
      ctx.stdout('');
      ctx.stdout('Review these, then run `decision-core enforce` to turn on real blocking.');
    }
  } catch (err) {
    ctx.stderr(`Error reading observations: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  return 0;
}
