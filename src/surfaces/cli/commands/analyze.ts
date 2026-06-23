/**
 * CLI Command: decision-core analyze <pack.yaml>
 *
 * Analyzes a compiled policy pack for conflicting or ambiguous rules.
 * This is the dedicated production command for conflict detection.
 */

import type { CliContext } from '../cli.js';
import { loadPackFromPath } from '../../../packs/pack-loader.js';
import { analyzePolicyPack } from '../../../policy/analysis/conflict-detector.js';

export async function analyzeCommand(ctx: CliContext): Promise<number> {
  const packPath = ctx.args.positionals?.[0] || (ctx.args as any)._?.[0];

  if (!packPath) {
    ctx.stderr('Usage: decision-core analyze <path-to-pack.yaml> [--json]');
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
      ctx.stdout(`  Suggested: ${c.suggestedFix}\n`);
    }

    return 1;
  } catch (err: any) {
    ctx.stderr(`Failed to analyze pack: ${err.message}`);
    return 1;
  }
}
