import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createHash, randomBytes } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { AgentAuthStoreSchema, type AgentAuthStore, type AgentAuthBinding } from './agent-auth.contracts.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('agent-auth');

export function loadAgentAuthStore(path?: string): AgentAuthStore {
  const resolvedPath = resolve(path ?? '.decision-core/agent-auth.yaml');

  if (!existsSync(resolvedPath)) {
    throw new Error(`Agent auth store not found: ${resolvedPath}`);
  }

  const raw = readFileSync(resolvedPath, 'utf-8');
  const parsed = parseYaml(raw);
  return AgentAuthStoreSchema.parse(parsed);
}

export function tryLoadAgentAuthStore(path?: string): AgentAuthStore | null {
  try {
    return loadAgentAuthStore(path);
  } catch {
    return null;
  }
}

export function hashToken(token: string, salt?: string): string {
  const material = salt ? `${salt}:${token}` : token;
  return createHash('sha256').update(material).digest('hex');
}

export function resolveTokenSubject(token: string, store: AgentAuthStore): AgentAuthBinding | null {
  const binding = store.bindings.find((b) => b.subject === hashToken(token, b.salt));

  if (!binding) {
    logger.warn('Token subject not found in auth store');
    return null;
  }

  return binding;
}

export interface IdentityResolution {
  agentId: string;
  tenantId: string;
  roles: string[];
}

export interface IdentityResolutionError {
  code: 'no_token' | 'unknown_token' | 'disabled_binding' | 'agent_mismatch' | 'agent_disabled';
  message: string;
}

export function resolveIdentity(
  token: string | undefined,
  bodyAgentId: string | undefined,
  authStore: AgentAuthStore,
  resolveRolesFn: (agentId: string) => string[],
  isAgentEnabled: (agentId: string) => boolean,
): IdentityResolution | IdentityResolutionError {
  if (!token) {
    return { code: 'no_token', message: 'No bearer token provided' };
  }

  const binding = resolveTokenSubject(token, authStore);
  if (!binding) {
    return { code: 'unknown_token', message: 'Bearer token not recognized' };
  }

  if (!binding.enabled) {
    return { code: 'disabled_binding', message: `Auth binding for ${binding.agentId} is disabled` };
  }

  if (bodyAgentId && bodyAgentId !== binding.agentId) {
    logger.warn(
      { claimedAgentId: bodyAgentId, authenticatedAgentId: binding.agentId },
      'Identity mismatch: body agentId does not match token-bound identity',
    );
    return {
      code: 'agent_mismatch',
      message: `Body agentId "${bodyAgentId}" does not match authenticated identity "${binding.agentId}"`,
    };
  }

  if (!isAgentEnabled(binding.agentId)) {
    return { code: 'agent_disabled', message: `Agent ${binding.agentId} is disabled in registry` };
  }

  const roles = resolveRolesFn(binding.agentId);

  return {
    agentId: binding.agentId,
    tenantId: binding.tenantId,
    roles,
  };
}

export function isIdentityError(result: IdentityResolution | IdentityResolutionError): result is IdentityResolutionError {
  return 'code' in result;
}

export function generateAgentToken(): string {
  return randomBytes(32).toString('hex');
}

export function generateAgentSalt(): string {
  return randomBytes(16).toString('hex');
}
