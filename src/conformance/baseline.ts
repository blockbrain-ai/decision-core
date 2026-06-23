/**
 * Regression Baseline
 *
 * Compares conformance run results against a stored baseline
 * and generates/updates the baseline file.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import type { ConformanceRunResult, ScenarioResult } from './runner.js';

export interface BaselineEntry {
  scenarioId: string;
  fixtureVersion: string;
  expectedResult: 'pass' | 'fail';
  actualResult: 'pass' | 'fail';
  timestamp: string;
}

export interface BaselineFile {
  version: string;
  generatedAt: string;
  fixtureVersion: string;
  entries: BaselineEntry[];
}

export interface BaselineComparison {
  regressed: Array<{ scenarioId: string; was: string; now: string }>;
  improved: Array<{ scenarioId: string; was: string; now: string }>;
  added: string[];
  removed: string[];
  unchanged: number;
  totalBaseline: number;
  totalCurrent: number;
}

function scenarioId(result: ScenarioResult): string {
  return `${result.filename}::${result.scenarioName}`;
}

/**
 * Generate a baseline file from conformance run results.
 */
export function generateBaseline(runResult: ConformanceRunResult): BaselineFile {
  const entries: BaselineEntry[] = runResult.results.map((r) => ({
    scenarioId: scenarioId(r),
    fixtureVersion: '1.0.0',
    expectedResult: r.passed ? 'pass' : 'fail',
    actualResult: r.passed ? 'pass' : 'fail',
    timestamp: runResult.timestamp,
  }));

  return {
    version: '1.0.0',
    generatedAt: runResult.timestamp,
    fixtureVersion: '1.0.0',
    entries,
  };
}

/**
 * Save baseline to disk.
 */
export function saveBaseline(baselinePath: string, baseline: BaselineFile): void {
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
}

/**
 * Load baseline from disk. Returns null if not found.
 */
export function loadBaseline(baselinePath: string): BaselineFile | null {
  if (!existsSync(baselinePath)) return null;
  const raw = readFileSync(baselinePath, 'utf-8');
  return JSON.parse(raw) as BaselineFile;
}

/**
 * Compare current run results against the baseline.
 */
export function compareBaseline(
  baseline: BaselineFile,
  runResult: ConformanceRunResult,
): BaselineComparison {
  const baselineMap = new Map(baseline.entries.map((e) => [e.scenarioId, e]));
  const currentMap = new Map(
    runResult.results.map((r) => [scenarioId(r), r.passed ? 'pass' : 'fail']),
  );

  const regressed: BaselineComparison['regressed'] = [];
  const improved: BaselineComparison['improved'] = [];
  const added: string[] = [];
  const removed: string[] = [];
  let unchanged = 0;

  for (const [id, currentResult] of currentMap) {
    const baseEntry = baselineMap.get(id);
    if (!baseEntry) {
      added.push(id);
    } else if (baseEntry.expectedResult === 'pass' && currentResult === 'fail') {
      regressed.push({ scenarioId: id, was: 'pass', now: 'fail' });
    } else if (baseEntry.expectedResult === 'fail' && currentResult === 'pass') {
      improved.push({ scenarioId: id, was: 'fail', now: 'pass' });
    } else {
      unchanged++;
    }
  }

  for (const id of baselineMap.keys()) {
    if (!currentMap.has(id)) {
      removed.push(id);
    }
  }

  return {
    regressed,
    improved,
    added,
    removed,
    unchanged,
    totalBaseline: baseline.entries.length,
    totalCurrent: runResult.results.length,
  };
}
