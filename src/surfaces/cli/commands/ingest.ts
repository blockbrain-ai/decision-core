/**
 * ingest command — Ingest a policy document.
 *
 * Usage: decision-core ingest <path-to-policy.md>
 */

import { createIngestionOrchestrator } from '../../../knowledge/ingestion/index.js';
import { InMemoryClauseRepository } from '../../../persistence/memory/in-memory-clause.repository.js';
import type { TenantId } from '../../../contracts/common.contracts.js';
import type { CliContext } from '../cli.js';

export async function ingestCommand(ctx: CliContext): Promise<number> {
  const filePath = ctx.args.positionals[0] ?? (typeof ctx.flags['file'] === 'string' ? ctx.flags['file'] : undefined);

  if (!filePath) {
    ctx.stderr('Usage: decision-core ingest <path-to-policy.md>');
    ctx.stderr('  Ingests a Markdown policy document into the knowledge base.');
    return 1;
  }

  const tenantId = (ctx.config?.tenantId ?? 'default') as unknown as TenantId;
  const clauseRepo = new InMemoryClauseRepository();
  const orchestrator = createIngestionOrchestrator(clauseRepo);

  const result = await orchestrator.ingest(tenantId, filePath);

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify({
      title: result.sourceDocument.title,
      sourceHash: result.sourceDocument.sourceHash,
      isDuplicate: result.isDuplicate,
      sections: result.sections.length,
      clauses: result.extractedClauses.length,
      normalizedClauses: result.normalizedClauses.length,
      changes: {
        added: result.changeReport.added.length,
        modified: result.changeReport.modified.length,
        removed: result.changeReport.removed.length,
        unchanged: result.changeReport.unchanged.length,
      },
    }, null, 2));
  } else {
    ctx.stdout(`Ingested: ${result.sourceDocument.title}`);
    ctx.stdout(`  Source hash: ${result.sourceDocument.sourceHash}`);
    ctx.stdout(`  Sections: ${result.sections.length}`);
    ctx.stdout(`  Clauses extracted: ${result.extractedClauses.length}`);
    ctx.stdout(`  Normalized: ${result.normalizedClauses.length}`);
    if (result.isDuplicate) {
      ctx.stdout(`  Warning: Duplicate document (already ingested)`);
    }
    ctx.stdout(`  Changes: +${result.changeReport.added.length} ~${result.changeReport.modified.length} -${result.changeReport.removed.length} =${result.changeReport.unchanged.length}`);
  }

  return 0;
}
