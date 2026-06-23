/**
 * Org-Mode Scenario Suite — Wires YAML scenario files into Vitest.
 *
 * Uses the RBAC test server so that role-scoped scenarios evaluate
 * correctly through the full HTTP stack.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { createRbacTestServer } from '../../helpers/rbac-test-server.js';
import { createAgentHttpClient } from '../../helpers/agent-http-client.js';
import { loadScenarios, assertStepResult } from '../../helpers/scenario-runner.js';
import type { OrgTestServerInstance } from '../../helpers/org-test-server.js';

let server: OrgTestServerInstance;
let baseUrl: string;

beforeAll(async () => {
  server = await createRbacTestServer();
  baseUrl = server.baseUrl();
});

afterAll(async () => {
  await server.close();
});

// Load and register all YAML scenario files in this directory.
const scenarioFiles = ['rbac-scenarios.yaml', 'isolation-scenarios.yaml'];

for (const file of scenarioFiles) {
  describe(`scenarios: ${file}`, () => {
    const scenarios = loadScenarios(resolve(__dirname, file));

    for (const scenario of scenarios) {
      describe(scenario.name, () => {
        for (const step of scenario.steps) {
          it(step.name, async () => {
            const client = createAgentHttpClient(baseUrl, step.agentId);
            const response = await (step.method === 'GET'
              ? client.get(step.path)
              : client.post(step.path, { body: step.body }));
            assertStepResult(response, step);
          });
        }
      });
    }
  });
}
