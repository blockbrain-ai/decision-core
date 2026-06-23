/**
 * explain command — Explain a previous decision by correlation ID.
 *
 * Usage: decision-core explain <correlationId>
 */

import { createDecisionCore } from '../../sdk/index.js';
import type { CliContext } from '../cli.js';

export async function explainCommand(ctx: CliContext): Promise<number> {
  const correlationId = ctx.args.positionals[0] ?? (typeof ctx.flags['id'] === 'string' ? ctx.flags['id'] : undefined);

  if (!correlationId) {
    ctx.stderr('Usage: decision-core explain <correlationId>');
    ctx.stderr('  Explains a previous decision by its correlation ID.');
    return 1;
  }

  const core = await createDecisionCore({
    tenantId: ctx.config?.tenantId ?? 'default',
    persistence: ctx.config?.persistence ?? 'memory',
    policyPackPath: ctx.config?.policyPackPath,
  });

  const explanation = await core.explain(correlationId);

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify(explanation, null, 2));
  } else {
    ctx.stdout(`Explanation for: ${explanation.correlationId}`);
    ctx.stdout(`  Tenant: ${explanation.tenantId}`);
    if (explanation.records.length > 0) {
      ctx.stdout(`  Records:`);
      for (const record of explanation.records) {
        ctx.stdout(`    [${record.surface}] ${record.status} (confidence: ${record.confidence}, latency: ${record.latency}ms)`);
      }
    } else {
      ctx.stdout('  No records found for this correlation ID.');
    }
  }

  return 0;
}
