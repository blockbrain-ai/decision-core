/**
 * Validation for setup-generated artifacts.
 *
 * This is shared by the CLI setup flow and the MCP setup tools so both paths
 * enforce the same structured policy and scenario gates before activation.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { ParsedStructuredClause } from '../knowledge/authoring/structured-clause.types.js';
import { parseStructuredDocument } from '../knowledge/authoring/frontmatter-parser.js';
import { createPolicyLinter } from '../knowledge/linter/policy-linter.service.js';
import { SurfaceContractRegistry } from '../knowledge/surfaces/surface-contract-registry.service.js';
import type { GeneratedArtifact } from './generate-artifacts.js';
import { PolicyPackSchema as SdkPolicyPackSchema } from '../surfaces/sdk/types.js';

export interface GeneratedArtifactValidationIssue {
  path: string;
  message: string;
  ruleId?: string;
  clauseId?: string;
}

export interface GeneratedArtifactValidationResult {
  valid: boolean;
  policyCount: number;
  scenarioCount: number;
  registryLoaded: boolean;
  issues: GeneratedArtifactValidationIssue[];
}

export function validateGeneratedArtifacts(artifacts: GeneratedArtifact[]): GeneratedArtifactValidationResult {
  const issues: GeneratedArtifactValidationIssue[] = [];
  const registry = new SurfaceContractRegistry();
  const registryLoaded = loadDefaultSurfaceContracts(registry);
  const linter = createPolicyLinter();
  let policyCount = 0;
  let scenarioCount = 0;

  if (!registryLoaded) {
    issues.push({
      path: 'config/surface-contracts/default.yaml',
      message: 'Default surface contracts could not be loaded',
    });
  }

  for (const artifact of artifacts) {
    if (!isSafeArtifactPath(artifact.path)) {
      issues.push({ path: artifact.path, message: 'Generated artifact path must stay inside the output directory' });
      continue;
    }

    if (artifact.category === 'policy') {
      policyCount += 1;
      try {
        const { document, parsedClauses } = parseStructuredDocument(artifact.content, artifact.path);
        if (!registryLoaded) continue;

        const report = linter.lint({
          clauses: document.clauses,
          frontmatter: document.frontmatter,
          surfaceRegistry: registry,
          hasStructuredClauses: parsedClauses.length > 0,
          sourceLineRefs: toSourceLineRefMap(parsedClauses),
          documentSource: artifact.path,
        });

        for (const diagnostic of report.diagnostics.filter((d) => d.severity === 'error')) {
          issues.push({
            path: artifact.path,
            ruleId: diagnostic.ruleId,
            clauseId: diagnostic.clauseId,
            message: diagnostic.message,
          });
        }
      } catch (err) {
        issues.push({
          path: artifact.path,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (artifact.path === 'policy-pack.yaml') {
      try {
        SdkPolicyPackSchema.parse(parseYaml(artifact.content));
      } catch (err) {
        issues.push({
          path: artifact.path,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (artifact.path === 'tests/generated-scenarios.json') {
      try {
        const scenarios = JSON.parse(artifact.content) as unknown;
        if (!Array.isArray(scenarios)) {
          issues.push({ path: artifact.path, message: 'Generated scenarios must be a JSON array' });
          continue;
        }

        scenarioCount = scenarios.length;
        for (const [index, scenario] of scenarios.entries()) {
          if (!isScenario(scenario)) {
            issues.push({ path: artifact.path, message: `Scenario ${index} has invalid shape` });
          }
        }
      } catch (err) {
        issues.push({
          path: artifact.path,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (policyCount === 0) {
    issues.push({ path: 'policies', message: 'No policy artifacts generated' });
  }

  if (scenarioCount === 0) {
    issues.push({ path: 'tests/generated-scenarios.json', message: 'No generated scenarios found' });
  }

  return {
    valid: issues.length === 0,
    policyCount,
    scenarioCount,
    registryLoaded,
    issues,
  };
}

function toSourceLineRefMap(parsedClauses: ParsedStructuredClause[]) {
  return Object.fromEntries(parsedClauses.map(({ clause, sourceLineRef }) => [clause.clause_id, sourceLineRef]));
}

function loadDefaultSurfaceContracts(registry: SurfaceContractRegistry): boolean {
  const candidates = [
    resolve(process.cwd(), 'config/surface-contracts/default.yaml'),
    fileURLToPath(new URL('../../config/surface-contracts/default.yaml', import.meta.url)),
    fileURLToPath(new URL('../../../config/surface-contracts/default.yaml', import.meta.url)),
  ];

  for (const candidate of new Set(candidates)) {
    if (!existsSync(candidate)) continue;
    registry.loadFromFile(candidate);
    return true;
  }

  return false;
}

function isScenario(value: unknown): value is { name: string; input: Record<string, unknown>; expected: string } {
  if (!value || typeof value !== 'object') return false;
  const scenario = value as Record<string, unknown>;
  const input = scenario['input'] as Record<string, unknown> | undefined;
  return (
    typeof scenario['name'] === 'string'
    && typeof scenario['expected'] === 'string'
    && ['allow', 'deny', 'approve_required'].includes(scenario['expected'])
    && !!input
    && typeof input === 'object'
    && !Array.isArray(input)
    && typeof input['action'] === 'string'
    && input['action_type'] === undefined
    && input['tool_name'] === undefined
  );
}

function isSafeArtifactPath(path: string): boolean {
  if (isAbsolute(path)) return false;
  const normalized = normalize(path);
  if (!normalized || normalized === '.') return false;
  return !normalized.split(/[\\/]+/).includes('..');
}
