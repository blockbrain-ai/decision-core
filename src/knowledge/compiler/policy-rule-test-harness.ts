/**
 * Policy Rule Test Harness
 *
 * Utility that executes compiled rules against sample decision contexts
 * and reports pass/fail results. Useful for policy authors to validate
 * rules before activating them.
 */

import { createLogger } from '../../utils/logger.js';
import { createCompiledRuleEvaluator } from './compiled-rule-evaluator.js';
import type { CompiledRule, DecisionContext, RuleEvalResult } from './policy-rule-expression.types.js';

const logger = createLogger('policy-rule-test-harness');

export interface TestCase {
  name: string;
  context: DecisionContext;
  expectedResults: Array<{
    ruleId: string;
    expectedPass: boolean;
  }>;
}

export interface TestCaseResult {
  name: string;
  passed: boolean;
  ruleResults: RuleEvalResult[];
  failures: Array<{
    ruleId: string;
    expected: boolean;
    actual: boolean;
  }>;
}

export interface HarnessReport {
  totalTests: number;
  passed: number;
  failed: number;
  results: TestCaseResult[];
  executedAt: string;
}

export interface PolicyRuleTestHarness {
  runTestCase(rules: CompiledRule[], testCase: TestCase): TestCaseResult;
  runAllTests(rules: CompiledRule[], testCases: TestCase[]): HarnessReport;
  runAgainstContext(rules: CompiledRule[], context: DecisionContext): RuleEvalResult[];
}

export function createPolicyRuleTestHarness(): PolicyRuleTestHarness {
  const evaluator = createCompiledRuleEvaluator();

  return {
    runTestCase(rules: CompiledRule[], testCase: TestCase): TestCaseResult {
      const ruleResults = evaluator.evaluateAll(rules, testCase.context);
      const failures: TestCaseResult['failures'] = [];

      for (const expected of testCase.expectedResults) {
        const actual = ruleResults.find((r) => r.ruleId === expected.ruleId);
        if (!actual) {
          failures.push({
            ruleId: expected.ruleId,
            expected: expected.expectedPass,
            actual: false,
          });
          continue;
        }
        if (actual.passed !== expected.expectedPass) {
          failures.push({
            ruleId: expected.ruleId,
            expected: expected.expectedPass,
            actual: actual.passed,
          });
        }
      }

      return {
        name: testCase.name,
        passed: failures.length === 0,
        ruleResults,
        failures,
      };
    },

    runAllTests(rules: CompiledRule[], testCases: TestCase[]): HarnessReport {
      const results = testCases.map((tc) => this.runTestCase(rules, tc));
      const passed = results.filter((r) => r.passed).length;
      const failed = results.length - passed;

      logger.info({ totalTests: results.length, passed, failed }, 'Test harness run complete');

      return {
        totalTests: results.length,
        passed,
        failed,
        results,
        executedAt: new Date().toISOString(),
      };
    },

    runAgainstContext(rules: CompiledRule[], context: DecisionContext): RuleEvalResult[] {
      return evaluator.evaluateAll(rules, context);
    },
  };
}
