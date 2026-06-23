/**
 * CLI Command: decision-core policy analyze <pack.yaml>
 *
 * Analyzes a policy pack for conflicting or ambiguous rules.
 * This is the dedicated command for conflict detection (separate from
 * document validation which uses `validate`).
 */

import type { CliContext } from '../cli.js';
import { loadPackFromPath } from '../../../packs/pack-loader.js';
import { analyzePolicyPack } from '../../../policy/analysis/conflict-detector.js';

export async function policyAnalyzeCommand(ctx: CliContext): Promise<number> {
  const packPath = ctx.args.positionals?.[1] || (ctx.args as any)._?.[1];

  if (!packPath) {
    ctx.stderr('Usage: decision-core policy analyze <path-to-pack.yaml> [--json]');
    return 1;
  }

  try {
    const pack = loadPackFromPath(packPath);
    const report = analyzePolicyPack(pack);

    if ((ctx.args as any).json || (ctx.args as any).flags?.json) {
      ctx.stdout(JSON.stringify(report, null, 2));
      return report.hasConflicts ? 1 : 0;
    }

    if (!report.hasConflicts) {
      ctx.stdout(`✅ No conflicts detected in ${pack.name} (v${pack.version})`);
      ctx.stdout(`   Analyzed ${report.summary.totalRules} rules.`);
      return 0;
    }

    ctx.stdout(`\n⚠️  ${report.conflicts.length} conflict(s) detected in ${pack.name} (v${pack.version})\n`);

    for (const c of report.conflicts) {
      ctx.stdout(`[${c.severity.toUpperCase()}] ${c.type}`);
      ctx.stdout(`  ${c.description}`);
      ctx.stdout(`  Suggested fix: ${c.suggestedFix}\n`);
    }

    return 1; // non-zero on conflicts found
  } catch (err: any) {
    ctx.stderr(`Failed to analyze pack: ${err.message}`);
    return 1;
  }
}
