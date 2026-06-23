/**
 * Conformance Formatter Tests
 */

import { describe, it, expect } from 'vitest';
import {
  formatRunMarkdown,
  formatRunJson,
  formatBaselineMarkdown,
  formatBaselineJson,
} from './formatters.js';
import type { ConformanceRunResult } from './runner.js';
import type { BaselineComparison } from './baseline.js';

describe('formatters', () => {
  const runResult: ConformanceRunResult = {
    total: 3,
    passed: 2,
    failed: 1,
    skipped: 0,
    releaseBlockingFailures: 1,
    timestamp: '2026-05-09T00:00:00.000Z',
    results: [
      {
        scenarioName: 'Scenario A',
        filename: 'a.yaml',
        tags: ['smoke'],
        releaseBlocking: false,
        passed: true,
        steps: [],
      },
      {
        scenarioName: 'Scenario B',
        filename: 'b.yaml',
        tags: ['release-blocking'],
        releaseBlocking: true,
        passed: false,
        steps: [
          {
            stepName: 'step 1',
            passed: false,
            expected: { status: 200, verdict: 'allow' },
            actual: { status: 200, verdict: 'deny' },
          },
        ],
      },
      {
        scenarioName: 'Scenario C',
        filename: 'c.yaml',
        tags: [],
        releaseBlocking: false,
        passed: true,
        steps: [],
      },
    ],
  };

  describe('formatRunMarkdown', () => {
    it('includes summary table', () => {
      const output = formatRunMarkdown(runResult);
      expect(output).toContain('# Conformance Results');
      expect(output).toContain('| Total | 3 |');
      expect(output).toContain('| Passed | 2 |');
      expect(output).toContain('| Failed | 1 |');
      expect(output).toContain('| Release-Blocking Failures | 1 |');
    });

    it('includes failed scenario details', () => {
      const output = formatRunMarkdown(runResult);
      expect(output).toContain('## Failed Scenarios');
      expect(output).toContain('Scenario B');
      expect(output).toContain('YES');
    });

    it('includes passed scenario list', () => {
      const output = formatRunMarkdown(runResult);
      expect(output).toContain('## Passed Scenarios');
      expect(output).toContain('Scenario A');
      expect(output).toContain('Scenario C');
    });
  });

  describe('formatRunJson', () => {
    it('produces valid JSON', () => {
      const output = formatRunJson(runResult);
      const parsed = JSON.parse(output);
      expect(parsed.total).toBe(3);
      expect(parsed.passed).toBe(2);
      expect(parsed.failed).toBe(1);
      expect(parsed.results).toHaveLength(3);
    });
  });

  describe('formatBaselineMarkdown', () => {
    const comparison: BaselineComparison = {
      regressed: [{ scenarioId: 'a.yaml::A', was: 'pass', now: 'fail' }],
      improved: [{ scenarioId: 'b.yaml::B', was: 'fail', now: 'pass' }],
      added: ['c.yaml::C'],
      removed: ['d.yaml::D'],
      unchanged: 5,
      totalBaseline: 8,
      totalCurrent: 8,
    };

    it('includes summary and regression details', () => {
      const output = formatBaselineMarkdown(comparison);
      expect(output).toContain('# Baseline Comparison');
      expect(output).toContain('| Regressed | 1 |');
      expect(output).toContain('| Improved | 1 |');
      expect(output).toContain('## Regressions');
      expect(output).toContain('a.yaml::A');
    });
  });

  describe('formatBaselineJson', () => {
    it('produces valid JSON', () => {
      const comparison: BaselineComparison = {
        regressed: [],
        improved: [],
        added: [],
        removed: [],
        unchanged: 5,
        totalBaseline: 5,
        totalCurrent: 5,
      };
      const parsed = JSON.parse(formatBaselineJson(comparison));
      expect(parsed.unchanged).toBe(5);
    });
  });
});
