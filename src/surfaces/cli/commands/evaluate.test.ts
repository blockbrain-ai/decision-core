/**
 * evaluate command tests
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateCommand } from './evaluate.js';
import type { CliContext } from '../cli.js';

function makeCtx(flags: Record<string, string | boolean> = {}, positionals: string[] = []): CliContext & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    config: undefined,
    flags,
    args: { command: 'evaluate', positionals, flags, subcommand: undefined },
    stdout: (msg: string) => output.push(msg),
    stderr: (msg: string) => errors.push(msg),
    output,
    errors,
  };
}

describe('evaluateCommand', () => {
  it('requires --surface and --action flags', async () => {
    const ctx = makeCtx({});
    const code = await evaluateCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.errors[0]).toContain('Usage');
  });

  it('evaluates a policy and returns verdict', async () => {
    const ctx = makeCtx({ surface: 'test-surface', action: 'file.read' });
    const code = await evaluateCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.output[0]).toContain('Verdict:');
  });

  it('outputs JSON when --json flag set', async () => {
    const ctx = makeCtx({ surface: 'test-surface', action: 'file.read', json: true });
    const code = await evaluateCommand(ctx);
    expect(code).toBe(0);
    const parsed = JSON.parse(ctx.output[0]);
    expect(parsed).toHaveProperty('verdict');
    expect(parsed).toHaveProperty('matchedPolicies');
  });

  it('parses context from --context JSON flag', async () => {
    const ctx = makeCtx({
      surface: 'test',
      action: 'deploy.prod',
      context: '{"financialImpact": 5000}',
    });
    const code = await evaluateCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.output[0]).toContain('Verdict:');
  });

  it('threads observe mode from CLI config into policy evaluation', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dc-cli-evaluate-observe-'));
    const packPath = join(tmpDir, 'policy-pack.yaml');
    writeFileSync(packPath, `
version: "1.0.0"
name: "cli-observe"
denyUnknownDefault: true
rules:
  - name: "deny deletes"
    actionTypePattern: "delete_*"
    defaultVerdict: "deny"
    priority: 90
`, 'utf-8');

    try {
      const ctx = makeCtx({ surface: 'api', action: 'delete_file', json: true });
      ctx.config = {
        tenantId: 'default',
        persistence: 'memory',
        tenantMode: 'single',
        policyPackPath: packPath,
        enforcementMode: 'observe',
      };

      const code = await evaluateCommand(ctx);
      expect(code).toBe(0);
      const parsed = JSON.parse(ctx.output[0]);
      expect(parsed.verdict).toBe('allow');
      expect(parsed.enforcementMode).toBe('observe');
      expect(parsed.observedDecision).toBe('deny');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('threads agent registry from CLI config so role-scoped rules use trusted roles', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dc-cli-evaluate-registry-'));
    const packPath = join(tmpDir, 'policy-pack.yaml');
    const registryPath = join(tmpDir, 'agents.yaml');
    writeFileSync(packPath, `
version: "1.0.0"
name: "cli-registry"
rules:
  - name: "finance high-value payment approval"
    actionTypePattern: "payment_*"
    maxAmountUsd: 1000
    requiredRoles: ["finance"]
    requireApproval: true
    priority: 90
`, 'utf-8');
    writeFileSync(registryPath, `
tenantId: default
agents:
  - agentId: fin-agent
    displayName: Finance Agent
    roles: ["finance"]
`, 'utf-8');

    try {
      const ctx = makeCtx({
        surface: 'api',
        action: 'payment_send',
        context: '{"agentId":"fin-agent","financialImpact":5000}',
        json: true,
      });
      ctx.config = {
        tenantId: 'default',
        persistence: 'memory',
        tenantMode: 'single',
        policyPackPath: packPath,
        agentRegistryPath: registryPath,
      };

      const code = await evaluateCommand(ctx);
      expect(code).toBe(0);
      const parsed = JSON.parse(ctx.output[0]);
      expect(parsed.verdict).toBe('approve_required');
      expect(parsed.matchedPolicies[0].ruleName).toBe('finance high-value payment approval');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
