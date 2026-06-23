/**
 * Conformance Runner Integration Tests
 *
 * Starts a real server and runs scenarios against it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { startConformanceServer, type ConformanceServerInstance } from './server-harness.js';
import { loadSuiteScenarios, filterByTags } from './scenario-loader.js';
import { runConformance } from './runner.js';

const PROJECT_ROOT = resolve(__dirname, '../..');
const SCENARIOS_DIR = resolve(PROJECT_ROOT, 'test/scenarios/org-mode');

describe('conformance runner', () => {
  let server: ConformanceServerInstance;

  beforeAll(async () => {
    server = await startConformanceServer(PROJECT_ROOT);
  });

  afterAll(async () => {
    await server.close();
  });

  it('runs RBAC scenarios and all pass', async () => {
    const files = loadSuiteScenarios(SCENARIOS_DIR);
    const rbacFile = files.find((f) => f.filename === 'rbac-scenarios.yaml');
    expect(rbacFile).toBeDefined();

    const scenarios = rbacFile!.scenarios.map((s) => ({
      filename: rbacFile!.filename,
      scenario: s,
    }));

    const result = await runConformance(scenarios, server.baseUrl);
    expect(result.total).toBeGreaterThan(0);
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(result.total);
  });

  it('runs smoke-tagged scenarios', async () => {
    const files = loadSuiteScenarios(SCENARIOS_DIR);
    const allScenarios = files.flatMap(
      (f) => f.scenarios.map((s) => ({ filename: f.filename, scenario: s })),
    );
    const smokeScenarios = allScenarios.filter(
      ({ scenario }) => filterByTags([scenario], ['smoke']).length > 0,
    );

    expect(smokeScenarios.length).toBeGreaterThan(0);
    const result = await runConformance(smokeScenarios, server.baseUrl);
    expect(result.total).toBe(smokeScenarios.length);
    expect(result.failed).toBe(0);
  });

  it('reports release-blocking failure count', async () => {
    const files = loadSuiteScenarios(SCENARIOS_DIR);
    const allScenarios = files.flatMap(
      (f) => f.scenarios.map((s) => ({ filename: f.filename, scenario: s })),
    );
    const releaseBlockingScenarios = allScenarios.filter(
      ({ scenario }) => scenario.releaseBlocking,
    );

    expect(releaseBlockingScenarios.length).toBeGreaterThan(0);
    const result = await runConformance(releaseBlockingScenarios, server.baseUrl);
    // All release-blocking scenarios should pass
    expect(result.releaseBlockingFailures).toBe(0);
  });

  it('runs full suite across all scenario files', async () => {
    const files = loadSuiteScenarios(SCENARIOS_DIR);
    const allScenarios = files.flatMap(
      (f) => f.scenarios.map((s) => ({ filename: f.filename, scenario: s })),
    );

    expect(allScenarios.length).toBeGreaterThan(20);
    const result = await runConformance(allScenarios, server.baseUrl);
    expect(result.total).toBe(allScenarios.length);
    // All conformance scenarios should pass
    expect(result.failed).toBe(0);
  });

  it('collects step-level results', async () => {
    const files = loadSuiteScenarios(SCENARIOS_DIR);
    const rbacFile = files.find((f) => f.filename === 'rbac-scenarios.yaml');
    const scenarios = rbacFile!.scenarios.slice(0, 1).map((s) => ({
      filename: rbacFile!.filename,
      scenario: s,
    }));

    const result = await runConformance(scenarios, server.baseUrl);
    expect(result.results[0].steps.length).toBeGreaterThan(0);
    expect(result.results[0].steps[0].passed).toBe(true);
    expect(result.results[0].steps[0].actual.status).toBe(200);
  });
});
