/**
 * Conformance Scenario Loader
 *
 * Loads YAML scenario files with tag support for the conformance CLI.
 * Extends the base scenario format with tags and release-blocking flags.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface ConformanceStepExpect {
  status: number;
  verdict?: 'allow' | 'deny' | 'approve_required';
  code?: string;
  errorContains?: string;
}

export interface ConformanceStep {
  name: string;
  agentId: string;
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
  expect: ConformanceStepExpect;
}

export interface ConformanceScenario {
  name: string;
  description?: string;
  tags?: string[];
  releaseBlocking?: boolean;
  conformanceSkip?: boolean;
  steps: ConformanceStep[];
}

export interface ConformanceScenarioFile {
  suite?: string;
  tags?: string[];
  scenarios: ConformanceScenario[];
}

export interface LoadedScenarioFile {
  filename: string;
  scenarios: ConformanceScenario[];
}

/**
 * Check whether a scenario has HTTP-style steps (agentId + method + path).
 */
function isHttpScenario(scenario: ConformanceScenario): boolean {
  return scenario.steps.length > 0 && scenario.steps.every(
    (s) => typeof s.agentId === 'string' && typeof s.method === 'string' && typeof s.path === 'string',
  );
}

/**
 * Load scenarios from a single YAML file, filtering to HTTP-compatible only.
 */
export function loadConformanceFile(filePath: string): ConformanceScenario[] {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = parseYaml(raw) as ConformanceScenarioFile;
  if (!parsed?.scenarios || !Array.isArray(parsed.scenarios)) return [];

  const fileTags = parsed.tags ?? [];

  return parsed.scenarios
    .filter(isHttpScenario)
    .filter((s) => !s.conformanceSkip)
    .map((s) => ({
      ...s,
      tags: [...new Set([...(s.tags ?? []), ...fileTags])],
      releaseBlocking: s.releaseBlocking ?? false,
    }));
}

/**
 * Load all YAML scenario files from a directory.
 */
export function loadSuiteScenarios(dir: string): LoadedScenarioFile[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') && !f.endsWith('.test.yaml'))
    .sort();

  return files.map((filename) => ({
    filename,
    scenarios: loadConformanceFile(join(dir, filename)),
  }));
}

/**
 * Filter scenarios by tags. A scenario matches if it has at least one of the requested tags.
 */
export function filterByTags(
  scenarios: ConformanceScenario[],
  tags: string[],
): ConformanceScenario[] {
  if (tags.length === 0) return scenarios;
  return scenarios.filter(
    (s) => s.tags?.some((t) => tags.includes(t)),
  );
}
