import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { stringify as stringifyYaml } from 'yaml';
import { loadAgentRegistry, resolveAgentRoles, findAgentById, findAgentsByRole } from './agent-registry.js';

const TMP_DIR = resolve(__dirname, '../../.test-tmp-registry');

function setup(config: Record<string, unknown>): string {
  mkdirSync(TMP_DIR, { recursive: true });
  const path = resolve(TMP_DIR, 'agents.yaml');
  writeFileSync(path, stringifyYaml(config), 'utf-8');
  return path;
}

function cleanup(): void {
  try { rmSync(TMP_DIR, { recursive: true }); } catch { /* ignore */ }
}

describe('agent-registry', () => {
  afterEach(cleanup);

  const validConfig = {
    tenantId: 'test-tenant',
    agents: [
      { agentId: 'finance-agent', displayName: 'Finance', roles: ['finance_approver', 'budget_viewer'], enabled: true, personalBrain: 'p-finance', authSubject: 'subj-finance' },
      { agentId: 'ops-agent', displayName: 'Ops', roles: ['ops_manager'], enabled: true, personalBrain: 'p-ops', authSubject: 'subj-ops' },
      { agentId: 'disabled-agent', displayName: 'Disabled', roles: ['viewer'], enabled: false, personalBrain: 'p-disabled' },
    ],
  };

  it('loads a valid agent registry', () => {
    const path = setup(validConfig);
    const registry = loadAgentRegistry(path);
    expect(registry.agents).toHaveLength(3);
    expect(registry.tenantId).toBe('test-tenant');
  });

  it('resolves roles for an enabled agent', () => {
    const path = setup(validConfig);
    const registry = loadAgentRegistry(path);
    expect(resolveAgentRoles(registry, 'finance-agent')).toEqual(['finance_approver', 'budget_viewer']);
  });

  it('returns empty roles for disabled agent', () => {
    const path = setup(validConfig);
    const registry = loadAgentRegistry(path);
    expect(resolveAgentRoles(registry, 'disabled-agent')).toEqual([]);
  });

  it('returns empty roles for unknown agent', () => {
    const path = setup(validConfig);
    const registry = loadAgentRegistry(path);
    expect(resolveAgentRoles(registry, 'nonexistent')).toEqual([]);
  });

  it('finds agent by ID', () => {
    const path = setup(validConfig);
    const registry = loadAgentRegistry(path);
    const agent = findAgentById(registry, 'ops-agent');
    expect(agent?.displayName).toBe('Ops');
  });

  it('finds agents by role', () => {
    const path = setup(validConfig);
    const registry = loadAgentRegistry(path);
    const agents = findAgentsByRole(registry, 'ops_manager');
    expect(agents).toHaveLength(1);
    expect(agents[0].agentId).toBe('ops-agent');
  });

  it('rejects duplicate authSubject across enabled agents', () => {
    const badConfig = {
      tenantId: 'test',
      agents: [
        { agentId: 'a', displayName: 'A', roles: ['r'], enabled: true, authSubject: 'same' },
        { agentId: 'b', displayName: 'B', roles: ['r'], enabled: true, authSubject: 'same' },
      ],
    };
    const path = setup(badConfig);
    expect(() => loadAgentRegistry(path)).toThrow();
  });

  it('rejects duplicate personalBrain across enabled agents', () => {
    const badConfig = {
      tenantId: 'test',
      agents: [
        { agentId: 'a', displayName: 'A', roles: ['r'], enabled: true, personalBrain: 'same-brain' },
        { agentId: 'b', displayName: 'B', roles: ['r'], enabled: true, personalBrain: 'same-brain' },
      ],
    };
    const path = setup(badConfig);
    expect(() => loadAgentRegistry(path)).toThrow();
  });

  it('throws when file does not exist', () => {
    expect(() => loadAgentRegistry('/nonexistent/agents.yaml')).toThrow();
  });
});
