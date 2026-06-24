/**
 * CLI Configuration Loader
 *
 * Loads Decision Core configuration from YAML file.
 * Default path: decision-core.yaml in CWD, overridable via --config flag.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('cli-config');

// ===========================================================================
// Config Schema
// ===========================================================================

export const CliConfigSchema = z.object({
  tenantId: z.string().min(1).default('default'),
  persistence: z.enum(['memory', 'sqlite']).default('memory'),
  tenantMode: z.enum(['single', 'multi']).default('single'),
  policyPackPath: z.string().optional(),
  denyUnknownDefault: z.boolean().optional(),
  // Master enforce/observe lever. 'observe' never blocks (records would-be verdict);
  // the non-breaking onboarding default. Omitted ⇒ enforce.
  enforcementMode: z.enum(['enforce', 'observe']).optional(),
  sqlitePath: z.string().optional(),
  routeConfigPath: z.string().optional(),
  agentRegistryPath: z.string().optional(),
  agentAuthPath: z.string().optional(),
  accessPolicyPath: z.string().optional(),
  provider: z
    .object({
      mode: z.enum(['host', 'disabled', 'direct', 'local', 'router']).default('disabled'),
      profilesPath: z.string().optional(),
      currentLab: z.string().optional(),
    })
    .optional(),
  surfaceContractPath: z.string().optional(),
  trust: z
    .object({
      policyPath: z.string().optional(),
      bindingsPath: z.string().optional(),
      registryPath: z.string().optional(),
    })
    .optional(),
  serve: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.number().int().nonnegative().default(0),
      bearerToken: z.string().optional(),
      allowUnauthenticatedLocal: z.boolean().default(false),
      mcp: z.boolean().default(false),
    })
    .optional(),
});

export type CliConfig = z.infer<typeof CliConfigSchema>;

// ===========================================================================
// Default Config Path
// ===========================================================================

const DEFAULT_CONFIG_FILENAME = 'decision-core.yaml';

// ===========================================================================
// Loader
// ===========================================================================

/**
 * Load CLI configuration from a YAML file.
 * Returns undefined if no config file is found at the default path.
 * Throws if an explicit --config path is provided but unreadable.
 */
export function loadCliConfig(configPath?: string): CliConfig | undefined {
  const resolvedPath = configPath
    ? resolve(configPath)
    : resolve(process.cwd(), DEFAULT_CONFIG_FILENAME);

  if (!existsSync(resolvedPath)) {
    if (configPath) {
      throw new Error(`Config file not found: ${resolvedPath}`);
    }

    const autoPackPath = resolve(process.cwd(), '.decision-core', 'policy-pack.yaml');
    if (existsSync(autoPackPath)) {
      logger.debug({ path: autoPackPath }, 'Auto-discovered .decision-core/policy-pack.yaml');
      return CliConfigSchema.parse({
        tenantId: 'default',
        persistence: 'memory',
        tenantMode: 'single',
        policyPackPath: autoPackPath,
        denyUnknownDefault: true,
      });
    }

    logger.debug({ path: resolvedPath }, 'No default config file found, using defaults');
    return undefined;
  }

  logger.debug({ path: resolvedPath }, 'Loading config file');

  const raw = readFileSync(resolvedPath, 'utf-8');
  const parsed = parseYaml(raw);

  const result = CliConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid config file: ${result.error.message}`);
  }

  return result.data;
}
