/**
 * Scenario Runner — YAML-driven typed Vitest test cases.
 *
 * Loads YAML scenario files, parses them into typed scenario objects,
 * and runs Vitest cases for each step with assertion helpers.
 */

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { describe, it, expect } from 'vitest';
import { createAgentHttpClient, type AgentHttpClient, type AgentResponse } from './agent-http-client.js';

export interface ScenarioStep {
  name: string;
  agentId: string;
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
  expect: {
    status: number;
    verdict?: 'allow' | 'deny' | 'approve_required';
    code?: string;
    errorContains?: string;
  };
}

export interface Scenario {
  name: string;
  description?: string;
  steps: ScenarioStep[];
}

export interface ScenarioFile {
  scenarios: Scenario[];
}

/**
 * Load scenarios from a YAML file.
 */
export function loadScenarios(filePath: string): Scenario[] {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = parseYaml(raw) as ScenarioFile;
  return parsed.scenarios;
}

/**
 * Assert a scenario step result against expected values.
 */
export function assertStepResult(response: AgentResponse, step: ScenarioStep): void {
  expect(response.status).toBe(step.expect.status);

  const data = response.data as Record<string, unknown>;

  if (step.expect.verdict) {
    const inner = data.data as Record<string, unknown> | undefined;
    expect(inner?.verdict).toBe(step.expect.verdict);
  }

  if (step.expect.code) {
    expect(data.code).toBe(step.expect.code);
  }

  if (step.expect.errorContains) {
    expect(data.error as string).toContain(step.expect.errorContains);
  }
}

/**
 * Run a single scenario step using an agent client.
 */
async function executeStep(
  client: AgentHttpClient,
  step: ScenarioStep,
): Promise<AgentResponse> {
  if (step.method === 'GET') {
    return client.get(step.path);
  }
  return client.post(step.path, { body: step.body });
}

/**
 * Run all scenarios from a YAML file as Vitest cases.
 *
 * @param filePath - Path to the YAML scenario file
 * @param baseUrl - Server base URL
 */
export function runScenarioFile(filePath: string, baseUrl: string): void {
  const scenarios = loadScenarios(filePath);

  for (const scenario of scenarios) {
    describe(scenario.name, () => {
      for (const step of scenario.steps) {
        it(step.name, async () => {
          const client = createAgentHttpClient(baseUrl, step.agentId);
          const response = await executeStep(client, step);
          assertStepResult(response, step);
        });
      }
    });
  }
}

/**
 * Run scenarios programmatically (without Vitest describe/it wrappers).
 * Returns results for each step for assertion in calling tests.
 */
export async function executeScenario(
  scenario: Scenario,
  baseUrl: string,
): Promise<Array<{ step: ScenarioStep; response: AgentResponse }>> {
  const results: Array<{ step: ScenarioStep; response: AgentResponse }> = [];

  for (const step of scenario.steps) {
    const client = createAgentHttpClient(baseUrl, step.agentId);
    const response = await executeStep(client, step);
    results.push({ step, response });
  }

  return results;
}
