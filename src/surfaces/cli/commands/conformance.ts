/**
 * conformance command — Run org-mode conformance scenarios and manage regression baselines.
 *
 * Usage:
 *   decision-core conformance --suite org-mode [--tags smoke] [--format json|markdown]
 *   decision-core conformance --check-baseline [--format json|markdown]
 *   decision-core conformance --update-baseline
 */

import { resolve } from 'node:path';
import type { CliContext } from '../cli.js';
import {
  loadSuiteScenarios,
  filterByTags,
  runConformance,
  startConformanceServer,
  generateBaseline,
  saveBaseline,
  loadBaseline,
  compareBaseline,
  formatRunMarkdown,
  formatRunJson,
  formatBaselineMarkdown,
  formatBaselineJson,
} from '../../../conformance/index.js';

const SUITE_DIRS: Record<string, string> = {
  'org-mode': 'test/scenarios/org-mode',
};

const DEFAULT_BASELINE_PATH = 'test/scenarios/org-mode/regression-baseline.json';

export async function conformanceCommand(ctx: CliContext): Promise<number> {
  const projectRoot = process.cwd();
  const format = (ctx.flags['format'] as string) ?? 'markdown';
  const suite = ctx.flags['suite'] as string | undefined;
  const tagsFlag = ctx.flags['tags'] as string | undefined;
  const checkBaseline = ctx.flags['check-baseline'] === true;
  const updateBaseline = ctx.flags['update-baseline'] === true;

  if (!suite && !checkBaseline && !updateBaseline) {
    ctx.stderr('Usage: decision-core conformance --suite <name> [--tags <tags>] [--format json|markdown]');
    ctx.stderr('       decision-core conformance --check-baseline [--format json|markdown]');
    ctx.stderr('       decision-core conformance --update-baseline');
    ctx.stderr('');
    ctx.stderr('Available suites: ' + Object.keys(SUITE_DIRS).join(', '));
    return 1;
  }

  const suiteName = suite ?? 'org-mode';
  const suiteDir = SUITE_DIRS[suiteName];
  if (!suiteDir) {
    ctx.stderr(`Unknown suite: ${suiteName}. Available: ${Object.keys(SUITE_DIRS).join(', ')}`);
    return 1;
  }

  const scenarioDir = resolve(projectRoot, suiteDir);
  const tags = tagsFlag ? tagsFlag.split(',').map((t) => t.trim()) : [];

  // Load scenarios
  const files = loadSuiteScenarios(scenarioDir);
  let allScenarios = files.flatMap(
    (f) => f.scenarios.map((s) => ({ filename: f.filename, scenario: s })),
  );

  if (tags.length > 0) {
    allScenarios = allScenarios.filter(
      ({ scenario }) => filterByTags([scenario], tags).length > 0,
    );
  }

  if (allScenarios.length === 0) {
    ctx.stderr('No matching scenarios found.');
    return 1;
  }

  // Start server
  ctx.stderr(`Starting conformance server...`);
  const server = await startConformanceServer(projectRoot);

  try {
    ctx.stderr(`Running ${allScenarios.length} scenarios against ${server.baseUrl}...`);
    const runResult = await runConformance(allScenarios, server.baseUrl);

    // --update-baseline: regenerate and save
    if (updateBaseline) {
      const baselinePath = resolve(projectRoot, DEFAULT_BASELINE_PATH);
      const baseline = generateBaseline(runResult);
      saveBaseline(baselinePath, baseline);
      ctx.stdout(`Baseline updated: ${baselinePath} (${baseline.entries.length} entries)`);
      return 0;
    }

    // --check-baseline: compare against existing baseline
    if (checkBaseline) {
      const baselinePath = resolve(projectRoot, DEFAULT_BASELINE_PATH);
      const baseline = loadBaseline(baselinePath);
      if (!baseline) {
        ctx.stderr(`Baseline not found: ${baselinePath}`);
        ctx.stderr('Run "decision-core conformance --update-baseline" to create it.');
        return 1;
      }

      const comparison = compareBaseline(baseline, runResult);
      const output = format === 'json'
        ? formatBaselineJson(comparison)
        : formatBaselineMarkdown(comparison);
      ctx.stdout(output);

      if (comparison.regressed.length > 0) {
        ctx.stderr(`${comparison.regressed.length} regression(s) detected.`);
        return 1;
      }
      return 0;
    }

    // Default: run and report
    const output = format === 'json'
      ? formatRunJson(runResult)
      : formatRunMarkdown(runResult);
    ctx.stdout(output);

    // Non-zero exit on release-blocking failures
    if (runResult.releaseBlockingFailures > 0) {
      ctx.stderr(`${runResult.releaseBlockingFailures} release-blocking scenario(s) failed.`);
      return 1;
    }

    return runResult.failed > 0 ? 1 : 0;
  } finally {
    await server.close();
  }
}
