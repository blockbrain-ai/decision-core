/**
 * Baseline Comparison Tests
 */

import { describe, it, expect } from 'vitest';
import {
  generateBaseline,
  compareBaseline,
  type BaselineFile,
} from './baseline.js';
import type { ConformanceRunResult, ScenarioResult } from './runner.js';

function makeResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    scenarioName: 'test scenario',
    filename: 'test.yaml',
    tags: [],
    releaseBlocking: false,
    passed: true,
    steps: [],
    ...overrides,
  };
}

function makeRunResult(results: ScenarioResult[]): ConformanceRunResult {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  return {
    total: results.length,
    passed,
    failed,
    skipped: 0,
    releaseBlockingFailures: results.filter((r) => !r.passed && r.releaseBlocking).length,
    results,
    timestamp: '2026-05-09T00:00:00.000Z',
  };
}

describe('baseline', () => {
  describe('generateBaseline', () => {
    it('creates baseline entries from run results', () => {
      const runResult = makeRunResult([
        makeResult({ scenarioName: 'A', filename: 'a.yaml', passed: true }),
        makeResult({ scenarioName: 'B', filename: 'b.yaml', passed: false }),
      ]);

      const baseline = generateBaseline(runResult);
      expect(baseline.version).toBe('1.0.0');
      expect(baseline.entries).toHaveLength(2);
      expect(baseline.entries[0].scenarioId).toBe('a.yaml::A');
      expect(baseline.entries[0].actualResult).toBe('pass');
      expect(baseline.entries[1].scenarioId).toBe('b.yaml::B');
      expect(baseline.entries[1].actualResult).toBe('fail');
    });
  });

  describe('compareBaseline', () => {
    it('detects no changes when identical', () => {
      const baseline: BaselineFile = {
        version: '1.0.0',
        generatedAt: '2026-05-08T00:00:00.000Z',
        fixtureVersion: '1.0.0',
        entries: [
          { scenarioId: 'a.yaml::A', fixtureVersion: '1.0.0', expectedResult: 'pass', actualResult: 'pass', timestamp: '2026-05-08T00:00:00.000Z' },
        ],
      };

      const runResult = makeRunResult([
        makeResult({ scenarioName: 'A', filename: 'a.yaml', passed: true }),
      ]);

      const comparison = compareBaseline(baseline, runResult);
      expect(comparison.unchanged).toBe(1);
      expect(comparison.regressed).toHaveLength(0);
      expect(comparison.improved).toHaveLength(0);
      expect(comparison.added).toHaveLength(0);
      expect(comparison.removed).toHaveLength(0);
    });

    it('detects regressions (pass → fail)', () => {
      const baseline: BaselineFile = {
        version: '1.0.0',
        generatedAt: '2026-05-08T00:00:00.000Z',
        fixtureVersion: '1.0.0',
        entries: [
          { scenarioId: 'a.yaml::A', fixtureVersion: '1.0.0', expectedResult: 'pass', actualResult: 'pass', timestamp: '2026-05-08T00:00:00.000Z' },
        ],
      };

      const runResult = makeRunResult([
        makeResult({ scenarioName: 'A', filename: 'a.yaml', passed: false }),
      ]);

      const comparison = compareBaseline(baseline, runResult);
      expect(comparison.regressed).toHaveLength(1);
      expect(comparison.regressed[0].scenarioId).toBe('a.yaml::A');
    });

    it('detects improvements (fail → pass)', () => {
      const baseline: BaselineFile = {
        version: '1.0.0',
        generatedAt: '2026-05-08T00:00:00.000Z',
        fixtureVersion: '1.0.0',
        entries: [
          { scenarioId: 'a.yaml::A', fixtureVersion: '1.0.0', expectedResult: 'fail', actualResult: 'fail', timestamp: '2026-05-08T00:00:00.000Z' },
        ],
      };

      const runResult = makeRunResult([
        makeResult({ scenarioName: 'A', filename: 'a.yaml', passed: true }),
      ]);

      const comparison = compareBaseline(baseline, runResult);
      expect(comparison.improved).toHaveLength(1);
    });

    it('compares against expected result instead of captured actual result', () => {
      const baseline: BaselineFile = {
        version: '1.0.0',
        generatedAt: '2026-05-08T00:00:00.000Z',
        fixtureVersion: '1.0.0',
        entries: [
          {
            scenarioId: 'a.yaml::A',
            fixtureVersion: '1.0.0',
            expectedResult: 'pass',
            actualResult: 'fail',
            timestamp: '2026-05-08T00:00:00.000Z',
          },
        ],
      };

      const runResult = makeRunResult([
        makeResult({ scenarioName: 'A', filename: 'a.yaml', passed: false }),
      ]);

      const comparison = compareBaseline(baseline, runResult);
      expect(comparison.regressed).toHaveLength(1);
      expect(comparison.improved).toHaveLength(0);
    });

    it('detects new and removed scenarios', () => {
      const baseline: BaselineFile = {
        version: '1.0.0',
        generatedAt: '2026-05-08T00:00:00.000Z',
        fixtureVersion: '1.0.0',
        entries: [
          { scenarioId: 'a.yaml::A', fixtureVersion: '1.0.0', expectedResult: 'pass', actualResult: 'pass', timestamp: '2026-05-08T00:00:00.000Z' },
          { scenarioId: 'old.yaml::Old', fixtureVersion: '1.0.0', expectedResult: 'pass', actualResult: 'pass', timestamp: '2026-05-08T00:00:00.000Z' },
        ],
      };

      const runResult = makeRunResult([
        makeResult({ scenarioName: 'A', filename: 'a.yaml', passed: true }),
        makeResult({ scenarioName: 'New', filename: 'new.yaml', passed: true }),
      ]);

      const comparison = compareBaseline(baseline, runResult);
      expect(comparison.added).toContain('new.yaml::New');
      expect(comparison.removed).toContain('old.yaml::Old');
    });
  });
});
