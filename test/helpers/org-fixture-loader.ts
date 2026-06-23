/**
 * Org Fixture Loader — Meridian Systems
 *
 * Loads and validates all Meridian Systems fixtures against their
 * respective Zod schemas. Returns typed fixture objects ready for
 * use in org-mode integration tests.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { AgentRegistryConfigSchema, type AgentRegistryConfig } from '../../src/identity/agent-registry.contracts.js';
import { AgentAuthStoreSchema, type AgentAuthStore } from '../../src/identity/agent-auth.contracts.js';
import { AccessPolicyConfigSchema, type AccessPolicyConfig } from '../../src/identity/access-policy.contracts.js';
import { PolicyPackSchema, type PolicyPack } from '../../src/contracts/policy-pack.contracts.js';
import { ToolInventorySchema, type ToolInventory } from '../../src/identity/tool-inventory.contracts.js';

const FIXTURES_DIR = resolve(__dirname, '../fixtures/meridian-systems');

export interface BrainFixture {
  brainId: string;
  agentId: string;
  mounted: boolean;
  data: Record<string, unknown>;
}

export interface MeridianFixtures {
  agents: AgentRegistryConfig;
  tokens: AgentAuthStore;
  policyPack: PolicyPack;
  accessPolicy: AccessPolicyConfig;
  toolInventory: ToolInventory;
  brains: BrainFixture[];
}

/**
 * Deterministic test tokens — never use in production.
 * Format: mrd-test-token-{agentId}
 */
export const MERIDIAN_TEST_TOKENS: Record<string, string> = {
  'ceo-agent': 'mrd-test-token-ceo-agent',
  'cfo-agent': 'mrd-test-token-cfo-agent',
  'finance-analyst-agent': 'mrd-test-token-finance-analyst-agent',
  'vp-eng-agent': 'mrd-test-token-vp-eng-agent',
  'hr-lead-agent': 'mrd-test-token-hr-lead-agent',
  'product-agent': 'mrd-test-token-product-agent',
  'contractor-agent': 'mrd-test-token-contractor-agent',
};

function loadYaml<T>(filename: string): T {
  const filePath = join(FIXTURES_DIR, filename);
  const raw = readFileSync(filePath, 'utf-8');
  return parseYaml(raw) as T;
}

function loadBrains(): BrainFixture[] {
  const brainsDir = join(FIXTURES_DIR, 'brains');
  const files = readdirSync(brainsDir).filter((f) => f.endsWith('.yaml'));
  return files.map((file) => {
    const raw = readFileSync(join(brainsDir, file), 'utf-8');
    return parseYaml(raw) as BrainFixture;
  });
}

/**
 * Load and validate all Meridian Systems fixtures.
 * Throws on schema validation failure with descriptive errors.
 */
export function loadMeridianFixtures(): MeridianFixtures {
  const agents = AgentRegistryConfigSchema.parse(loadYaml('agents.yaml'));
  const tokens = AgentAuthStoreSchema.parse(loadYaml('tokens.yaml'));
  const policyPack = PolicyPackSchema.parse(loadYaml('policy-pack.yaml'));
  const accessPolicy = AccessPolicyConfigSchema.parse(loadYaml('access-policy.yaml'));
  const toolInventory = ToolInventorySchema.parse(loadYaml('tool-inventory.yaml'));
  const brains = loadBrains();

  return { agents, tokens, policyPack, accessPolicy, toolInventory, brains };
}

/**
 * Get the test token for a given agent ID.
 */
export function getAgentToken(agentId: string): string {
  const token = MERIDIAN_TEST_TOKENS[agentId];
  if (!token) {
    throw new Error(`No test token defined for agent: ${agentId}`);
  }
  return token;
}

/**
 * Get all agent IDs from the fixtures.
 */
export function getAgentIds(): string[] {
  return Object.keys(MERIDIAN_TEST_TOKENS);
}

/**
 * Get the fixture directory path (for helpers that need file paths).
 */
export function getFixturesDir(): string {
  return FIXTURES_DIR;
}
