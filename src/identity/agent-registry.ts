import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { AgentRegistryConfigSchema, type AgentRegistryConfig, type AgentRegistration } from './agent-registry.contracts.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('agent-registry');

export function loadAgentRegistry(path?: string): AgentRegistryConfig {
  const resolvedPath = resolve(path ?? '.decision-core/agents.yaml');

  if (!existsSync(resolvedPath)) {
    throw new Error(`Agent registry not found: ${resolvedPath}`);
  }

  const raw = readFileSync(resolvedPath, 'utf-8');
  const parsed = parseYaml(raw);
  const config = AgentRegistryConfigSchema.parse(parsed);

  logger.info(
    { path: resolvedPath, agentCount: config.agents.length },
    'Agent registry loaded',
  );

  return config;
}

export function tryLoadAgentRegistry(path?: string): AgentRegistryConfig | null {
  try {
    return loadAgentRegistry(path);
  } catch {
    return null;
  }
}

export function resolveAgentRoles(registry: AgentRegistryConfig, agentId: string): string[] {
  const agent = registry.agents.find((a) => a.agentId === agentId && a.enabled);
  return agent?.roles ?? [];
}

export function findAgentById(registry: AgentRegistryConfig, agentId: string): AgentRegistration | undefined {
  return registry.agents.find((a) => a.agentId === agentId);
}

export function findAgentsByRole(registry: AgentRegistryConfig, role: string): AgentRegistration[] {
  return registry.agents.filter((a) => a.enabled && a.roles.includes(role));
}
