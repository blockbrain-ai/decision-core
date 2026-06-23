/**
 * history command — Show past decisions from the decision log.
 *
 * Usage: decision-core history [--surface <id>] [--limit <n>] [--from <date>] [--to <date>]
 */

import type { TenantId } from '../../../contracts/common.contracts.js';
import type { CliContext } from '../cli.js';

export async function historyCommand(ctx: CliContext): Promise<number> {
  if (ctx.config?.persistence !== 'sqlite' || !ctx.config?.sqlitePath) {
    if (ctx.flags['json']) {
      ctx.stdout(JSON.stringify({ error: 'History requires SQLite persistence.', records: [] }));
    } else {
      ctx.stderr('History requires SQLite persistence.');
      ctx.stderr('Configure persistence: "sqlite" and sqlitePath in decision-core.yaml,');
      ctx.stderr('or use: decision-core evaluate --persistence sqlite --sqlite-path ./decisions.db');
    }
    return 1;
  }

  try {
    const { createSqliteConnection } = await import('../../../persistence/sqlite/sqlite-connection.js');
    const { SqliteDecisionLogRepository } = await import('../../../persistence/sqlite/sqlite-decision-log.repository.js');

    const db = createSqliteConnection({ path: ctx.config.sqlitePath });
    const repo = new SqliteDecisionLogRepository(db);

    const tenantId = (ctx.config.tenantId ?? 'default') as TenantId;
    const limit = typeof ctx.flags['limit'] === 'string' ? parseInt(ctx.flags['limit'], 10) : 20;
    const surface = typeof ctx.flags['surface'] === 'string' ? ctx.flags['surface'] : undefined;
    const from = typeof ctx.flags['from'] === 'string' ? ctx.flags['from'] : undefined;
    const to = typeof ctx.flags['to'] === 'string' ? ctx.flags['to'] : undefined;

    const records = await repo.findAll(tenantId, { surface, from, to, limit });

    if (ctx.flags['json']) {
      ctx.stdout(JSON.stringify(records, null, 2));
    } else if (records.length === 0) {
      ctx.stdout('No decision records found.');
    } else {
      ctx.stdout(`Recent decisions (${records.length}):`);
      ctx.stdout('');
      for (const r of records) {
        ctx.stdout(`  ${r.createdAt}  ${r.surface}/${r.toolName}  ${r.status}  [${r.correlationId.slice(0, 12)}...]`);
      }
    }

    db.close();
  } catch (err) {
    ctx.stderr(`Error reading history: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  return 0;
}
