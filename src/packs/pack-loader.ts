/**
 * Policy Pack Loader
 *
 * Loads and validates policy pack YAML files from the bundled
 * config/packs directory or from a user-specified path.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import { PolicyPackSchema, type PolicyPack } from '../contracts/policy-pack.contracts.js';
import { PolicyPackSchema as SdkPolicyPackSchema } from '../surfaces/sdk/types.js';
import type { PolicyRuleCreateInput } from '../contracts/policy.contracts.js';
import { contractsPackToRules, sdkPackToRules } from './pack-rule-converter.js';
import { createLogger } from '../utils/logger.js';
import { resolveBundledConfigPath } from '../utils/bundled-paths.js';
import { analyzePolicyPack } from '../policy/analysis/conflict-detector.js';

const logger = createLogger('pack-loader');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BUNDLED_PACKS_DIR = resolveBundledConfigPath(__dirname, 'packs');

export const AVAILABLE_PACKS = ['personal', 'team', 'fintech', 'healthcare', 'saas'] as const;
export type AvailablePackName = (typeof AVAILABLE_PACKS)[number];

/**
 * Load a policy pack from the bundled packs directory by name.
 */
export function loadBundledPack(name: AvailablePackName): PolicyPack {
  const packPath = join(BUNDLED_PACKS_DIR, `${name}.yaml`);
  return loadPackFromPath(packPath);
}

/**
 * Load a policy pack from an arbitrary file path.
 */
export function loadPackFromPath(packPath: string): PolicyPack {
  const resolvedPath = resolve(packPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Policy pack file not found: ${resolvedPath}`);
  }

  logger.debug({ path: resolvedPath }, 'Loading policy pack');

  const raw = readFileSync(resolvedPath, 'utf-8');

  // Basic production security limits (Plan B foundation)
  const MAX_PACK_SIZE = 1 * 1024 * 1024; // 1 MiB
  if (raw.length > MAX_PACK_SIZE) {
    throw new Error(`Policy pack too large (${raw.length} bytes). Max allowed: ${MAX_PACK_SIZE} bytes.`);
  }

  const parsed = parseYaml(raw);

  const result = PolicyPackSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid policy pack at ${resolvedPath}: ${result.error.message}`
    );
  }

  const pack = result.data;

  // Basic rule count limit
  if (pack.rules.length > 2000) {
    throw new Error(`Policy pack contains too many rules (${pack.rules.length}). Max recommended: 2000.`);
  }

  // Run conflict analysis (production-grade validation)
  const conflictReport = analyzePolicyPack(pack);
  if (conflictReport.hasConflicts) {
    logger.warn(
      {
        path: resolvedPath,
        conflictCount: conflictReport.conflicts.length,
        highestSeverity: conflictReport.summary.highestSeverity,
      },
      'Policy pack contains conflicts'
    );
    // For v1: warn but do not fail load. Future versions will support strict mode.
  }

  logger.info({ name: pack.name, version: pack.version }, 'Policy pack loaded');
  return pack;
}

/**
 * Load all bundled policy packs.
 */
export function loadAllBundledPacks(): Map<AvailablePackName, PolicyPack> {
  const packs = new Map<AvailablePackName, PolicyPack>();

  for (const name of AVAILABLE_PACKS) {
    packs.set(name, loadBundledPack(name));
  }

  return packs;
}

/**
 * Get the file path for a bundled pack.
 */
export function getBundledPackPath(name: AvailablePackName): string {
  return join(BUNDLED_PACKS_DIR, `${name}.yaml`);
}

// ===========================================================================
// Unified Pack Loading (auto-detects contracts vs SDK format)
// ===========================================================================

export interface PackLoadResult {
  rules: PolicyRuleCreateInput[];
  denyUnknownDefault: boolean;
  sourceFormat: 'contracts-pack' | 'sdk-pack';
  packName?: string;
}

export function loadPackAsRules(packPath: string): PackLoadResult {
  const resolvedPath = resolve(packPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Policy pack file not found: ${resolvedPath}`);
  }

  const raw = readFileSync(resolvedPath, 'utf-8');
  const parsed = parseYaml(raw);

  if (isContractsFormat(parsed)) {
    const pack = PolicyPackSchema.parse(parsed);
    return {
      rules: contractsPackToRules(pack),
      denyUnknownDefault: false,
      sourceFormat: 'contracts-pack',
      packName: pack.name,
    };
  }

  const sdkResult = SdkPolicyPackSchema.safeParse(parsed);
  if (sdkResult.success) {
    return {
      rules: sdkPackToRules(sdkResult.data),
      denyUnknownDefault: sdkResult.data.denyUnknownDefault,
      sourceFormat: 'sdk-pack',
      packName: sdkResult.data.name,
    };
  }

  throw new Error(
    `Policy pack at ${resolvedPath} matches neither contracts nor SDK format: ${sdkResult.error.message}`,
  );
}

function isContractsFormat(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;
  return Array.isArray(obj['trustTiers']) || typeof obj['profile'] === 'string';
}
