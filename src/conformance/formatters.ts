/**
 * Conformance Output Formatters
 *
 * Renders conformance results and baseline comparisons
 * in markdown (human-readable) or JSON format.
 */

import type { ConformanceRunResult } from './runner.js';
import type { BaselineComparison } from './baseline.js';

/**
 * Format conformance run results as markdown.
 */
export function formatRunMarkdown(result: ConformanceRunResult): string {
  const lines: string[] = [];
  lines.push('# Conformance Results');
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total | ${result.total} |`);
  lines.push(`| Passed | ${result.passed} |`);
  lines.push(`| Failed | ${result.failed} |`);
  lines.push(`| Release-Blocking Failures | ${result.releaseBlockingFailures} |`);
  lines.push('');
  lines.push(`Timestamp: ${result.timestamp}`);
  lines.push('');

  if (result.failed > 0) {
    lines.push('## Failed Scenarios');
    lines.push('');
    lines.push('| Scenario | File | Tags | Release-Blocking |');
    lines.push('|----------|------|------|------------------|');
    for (const r of result.results.filter((r) => !r.passed)) {
      const tags = r.tags.length > 0 ? r.tags.join(', ') : '-';
      const blocking = r.releaseBlocking ? 'YES' : 'no';
      lines.push(`| ${r.scenarioName} | ${r.filename} | ${tags} | ${blocking} |`);
      for (const step of r.steps.filter((s) => !s.passed)) {
        const detail = step.error
          ? step.error
          : `expected status=${step.expected.status}${step.expected.verdict ? ` verdict=${step.expected.verdict}` : ''}, got status=${step.actual.status}${step.actual.verdict ? ` verdict=${step.actual.verdict}` : ''}`;
        lines.push(`|   - ${step.stepName} | | ${detail} | |`);
      }
    }
    lines.push('');
  }

  if (result.passed > 0) {
    lines.push('## Passed Scenarios');
    lines.push('');
    lines.push('| Scenario | File | Tags |');
    lines.push('|----------|------|------|');
    for (const r of result.results.filter((r) => r.passed)) {
      const tags = r.tags.length > 0 ? r.tags.join(', ') : '-';
      lines.push(`| ${r.scenarioName} | ${r.filename} | ${tags} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format conformance run results as JSON.
 */
export function formatRunJson(result: ConformanceRunResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format baseline comparison as markdown.
 */
export function formatBaselineMarkdown(comparison: BaselineComparison): string {
  const lines: string[] = [];
  lines.push('# Baseline Comparison');
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Baseline scenarios | ${comparison.totalBaseline} |`);
  lines.push(`| Current scenarios | ${comparison.totalCurrent} |`);
  lines.push(`| Unchanged | ${comparison.unchanged} |`);
  lines.push(`| Regressed | ${comparison.regressed.length} |`);
  lines.push(`| Improved | ${comparison.improved.length} |`);
  lines.push(`| Added | ${comparison.added.length} |`);
  lines.push(`| Removed | ${comparison.removed.length} |`);
  lines.push('');

  if (comparison.regressed.length > 0) {
    lines.push('## Regressions');
    lines.push('');
    lines.push('| Scenario | Was | Now |');
    lines.push('|----------|-----|-----|');
    for (const r of comparison.regressed) {
      lines.push(`| ${r.scenarioId} | ${r.was} | ${r.now} |`);
    }
    lines.push('');
  }

  if (comparison.improved.length > 0) {
    lines.push('## Improvements');
    lines.push('');
    lines.push('| Scenario | Was | Now |');
    lines.push('|----------|-----|-----|');
    for (const i of comparison.improved) {
      lines.push(`| ${i.scenarioId} | ${i.was} | ${i.now} |`);
    }
    lines.push('');
  }

  if (comparison.added.length > 0) {
    lines.push('## New Scenarios (not in baseline)');
    lines.push('');
    for (const id of comparison.added) {
      lines.push(`- ${id}`);
    }
    lines.push('');
  }

  if (comparison.removed.length > 0) {
    lines.push('## Removed Scenarios (in baseline but not current)');
    lines.push('');
    for (const id of comparison.removed) {
      lines.push(`- ${id}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format baseline comparison as JSON.
 */
export function formatBaselineJson(comparison: BaselineComparison): string {
  return JSON.stringify(comparison, null, 2);
}
