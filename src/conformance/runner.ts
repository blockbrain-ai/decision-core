/**
 * Conformance Runner
 *
 * Executes conformance scenarios against the RBAC test server
 * and collects structured results.
 */

import { getAgentToken } from './server-harness.js';
import type { ConformanceScenario, ConformanceStep } from './scenario-loader.js';

export interface StepResult {
  stepName: string;
  passed: boolean;
  expected: ConformanceStep['expect'];
  actual: {
    status: number;
    verdict?: string;
    code?: string;
    error?: string;
  };
  error?: string;
}

export interface ScenarioResult {
  scenarioName: string;
  filename: string;
  tags: string[];
  releaseBlocking: boolean;
  passed: boolean;
  steps: StepResult[];
}

export interface ConformanceRunResult {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  releaseBlockingFailures: number;
  results: ScenarioResult[];
  timestamp: string;
}

async function sendRequest(
  baseUrl: string,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  return { status: res.status, data };
}

function evaluateStep(
  step: ConformanceStep,
  response: { status: number; data: unknown },
): StepResult {
  const data = response.data as Record<string, unknown>;
  const inner = data.data as Record<string, unknown> | undefined;

  const actual: StepResult['actual'] = {
    status: response.status,
    verdict: inner?.verdict as string | undefined,
    code: data.code as string | undefined,
    error: data.error as string | undefined,
  };

  let passed = response.status === step.expect.status;

  if (passed && step.expect.verdict) {
    passed = inner?.verdict === step.expect.verdict;
  }
  if (passed && step.expect.code) {
    passed = data.code === step.expect.code;
  }
  if (passed && step.expect.errorContains) {
    passed = typeof data.error === 'string' && data.error.includes(step.expect.errorContains);
  }

  return { stepName: step.name, passed, expected: step.expect, actual };
}

/**
 * Run a single conformance scenario against the server.
 */
async function runScenario(
  scenario: ConformanceScenario,
  filename: string,
  baseUrl: string,
): Promise<ScenarioResult> {
  const stepResults: StepResult[] = [];
  let allPassed = true;

  for (const step of scenario.steps) {
    try {
      const token = getAgentToken(step.agentId);
      const response = await sendRequest(baseUrl, step.method, step.path, token, step.body);
      const result = evaluateStep(step, response);
      stepResults.push(result);
      if (!result.passed) allPassed = false;
    } catch (err) {
      stepResults.push({
        stepName: step.name,
        passed: false,
        expected: step.expect,
        actual: { status: 0 },
        error: err instanceof Error ? err.message : String(err),
      });
      allPassed = false;
    }
  }

  return {
    scenarioName: scenario.name,
    filename,
    tags: scenario.tags ?? [],
    releaseBlocking: scenario.releaseBlocking ?? false,
    passed: allPassed,
    steps: stepResults,
  };
}

/**
 * Run all conformance scenarios and return aggregated results.
 */
export async function runConformance(
  scenarios: Array<{ filename: string; scenario: ConformanceScenario }>,
  baseUrl: string,
): Promise<ConformanceRunResult> {
  const results: ScenarioResult[] = [];

  for (const { filename, scenario } of scenarios) {
    const result = await runScenario(scenario, filename, baseUrl);
    results.push(result);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const releaseBlockingFailures = results.filter((r) => !r.passed && r.releaseBlocking).length;

  return {
    total: results.length,
    passed,
    failed,
    skipped: 0,
    releaseBlockingFailures,
    results,
    timestamp: new Date().toISOString(),
  };
}
