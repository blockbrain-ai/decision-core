/**
 * Conformance Scenario Loader Tests
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  loadConformanceFile,
  loadSuiteScenarios,
  filterByTags,
} from './scenario-loader.js';

const SCENARIOS_DIR = resolve(__dirname, '../../test/scenarios/org-mode');

describe('scenario-loader', () => {
  describe('loadConformanceFile', () => {
    it('loads RBAC scenarios with tags', () => {
      const scenarios = loadConformanceFile(resolve(SCENARIOS_DIR, 'rbac-scenarios.yaml'));
      expect(scenarios.length).toBeGreaterThan(0);
      // File-level tags should be applied
      expect(scenarios[0].tags).toContain('rbac');
      expect(scenarios[0].tags).toContain('smoke');
    });

    it('filters out non-HTTP scenarios (onboarding conformance)', () => {
      const scenarios = loadConformanceFile(
        resolve(SCENARIOS_DIR, 'onboarding-conformance-scenarios.yaml'),
      );
      // Onboarding scenarios use fixture-based format, not HTTP
      expect(scenarios.length).toBe(0);
    });

    it('filters out conformanceSkip scenarios (spoofing)', () => {
      const scenarios = loadConformanceFile(resolve(SCENARIOS_DIR, 'spoofing-scenarios.yaml'));
      // Spoofing scenarios that require custom tokens are skipped
      const names = scenarios.map((s) => s.name);
      expect(names).not.toContain('Missing bearer token');
      expect(names).not.toContain('Unknown random token');
      expect(names).not.toContain('Disabled auth binding');
      // Valid baselines and identity mismatch should still be present
      expect(names).toContain('Valid CEO token — baseline');
      expect(names).toContain('Product token with CEO agentId in body');
    });

    it('preserves releaseBlocking flag', () => {
      const scenarios = loadConformanceFile(resolve(SCENARIOS_DIR, 'rbac-scenarios.yaml'));
      const cfoAllow = scenarios.find((s) => s.name === 'CFO finance report access — allow');
      expect(cfoAllow?.releaseBlocking).toBe(true);
    });
  });

  describe('loadSuiteScenarios', () => {
    it('loads all YAML files from suite directory', () => {
      const files = loadSuiteScenarios(SCENARIOS_DIR);
      expect(files.length).toBeGreaterThan(0);
      const filenames = files.map((f) => f.filename);
      expect(filenames).toContain('rbac-scenarios.yaml');
      expect(filenames).toContain('isolation-scenarios.yaml');
      expect(filenames).toContain('approval-scenarios.yaml');
    });

    it('excludes test files', () => {
      const files = loadSuiteScenarios(SCENARIOS_DIR);
      const filenames = files.map((f) => f.filename);
      expect(filenames.some((f) => f.endsWith('.test.ts'))).toBe(false);
      expect(filenames.some((f) => f.endsWith('.test.yaml'))).toBe(false);
    });
  });

  describe('filterByTags', () => {
    it('returns all scenarios when tags are empty', () => {
      const scenarios = loadConformanceFile(resolve(SCENARIOS_DIR, 'rbac-scenarios.yaml'));
      const filtered = filterByTags(scenarios, []);
      expect(filtered.length).toBe(scenarios.length);
    });

    it('filters by smoke tag', () => {
      const scenarios = loadConformanceFile(resolve(SCENARIOS_DIR, 'rbac-scenarios.yaml'));
      const filtered = filterByTags(scenarios, ['smoke']);
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.length).toBeLessThanOrEqual(scenarios.length);
      for (const s of filtered) {
        expect(s.tags).toContain('smoke');
      }
    });

    it('supports multiple tags (OR logic)', () => {
      const scenarios = loadConformanceFile(resolve(SCENARIOS_DIR, 'rbac-scenarios.yaml'));
      const smokeOnly = filterByTags(scenarios, ['smoke']);
      const releaseOnly = filterByTags(scenarios, ['release-blocking']);
      const both = filterByTags(scenarios, ['smoke', 'release-blocking']);
      expect(both.length).toBeGreaterThanOrEqual(Math.max(smokeOnly.length, releaseOnly.length));
    });
  });
});
