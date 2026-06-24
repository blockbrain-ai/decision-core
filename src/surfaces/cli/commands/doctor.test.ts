import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { stringify as stringifyYaml } from 'yaml';
import { doctorCommand } from './doctor.js';
import type { CliContext } from '../cli.js';

function makeCtx(flags: Record<string, string | boolean> = {}, config?: Record<string, unknown>): CliContext & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    config: config as never,
    flags,
    args: { command: 'doctor', positionals: [], flags },
    stdout: (msg: string) => output.push(msg),
    stderr: (msg: string) => errors.push(msg),
    output,
    errors,
  };
}

describe('doctor command', () => {
  let testDir: string;
  let origCwd: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `dc-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    origCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
  });

  it('fails when no config or pack exists', async () => {
    const ctx = makeCtx();
    const code = await doctorCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.output.some(l => l.includes('FAIL'))).toBe(true);
  });

  it('passes with valid config and pack', async () => {
    mkdirSync(join(testDir, '.decision-core'), { recursive: true });
    writeFileSync(join(testDir, 'decision-core.yaml'), stringifyYaml({
      tenantId: 'default',
      persistence: 'memory',
      tenantMode: 'single',
      policyPackPath: '.decision-core/policy-pack.yaml',
    }), 'utf-8');
    writeFileSync(join(testDir, '.decision-core', 'policy-pack.yaml'), stringifyYaml({
      version: '1.0.0',
      name: 'test',
      denyUnknownDefault: true,
      rules: [{ name: 'allow-read', actionTypePattern: 'read_*', priority: 50 }],
    }), 'utf-8');

    const ctx = makeCtx({}, {
      tenantId: 'default',
      persistence: 'memory',
      tenantMode: 'single',
      policyPackPath: join(testDir, '.decision-core', 'policy-pack.yaml'),
    });
    const code = await doctorCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.output.some(l => l.includes('All checks passed'))).toBe(true);
  });

  it('outputs JSON with --json flag', async () => {
    const ctx = makeCtx({ json: true });
    await doctorCommand(ctx);
    const parsed = JSON.parse(ctx.output[0]);
    expect(parsed).toHaveProperty('checks');
    expect(parsed).toHaveProperty('healthy');
  });

  it('detects auto-discovered pack', async () => {
    mkdirSync(join(testDir, '.decision-core'), { recursive: true });
    writeFileSync(join(testDir, '.decision-core', 'policy-pack.yaml'), stringifyYaml({
      version: '1.0.0',
      name: 'auto',
      rules: [{ name: 'r', actionTypePattern: 'r_*', priority: 50 }],
    }), 'utf-8');

    const ctx = makeCtx({ json: true });
    await doctorCommand(ctx);
    const parsed = JSON.parse(ctx.output[0]);
    const configCheck = parsed.checks.find((c: { name: string }) => c.name === 'config');
    expect(configCheck.status).toBe('pass');
    expect(configCheck.message).toContain('Auto-discovered');
  });

  it('reports OBSERVE mode as a visible warn with the review/enforce next steps', async () => {
    const ctx = makeCtx({ json: true }, { enforcementMode: 'observe' });
    await doctorCommand(ctx);
    const mode = JSON.parse(ctx.output[0]).checks.find((c: { name: string }) => c.name === 'mode');
    expect(mode.status).toBe('warn');
    expect(mode.message).toContain('OBSERVE MODE');
    expect(mode.message).toContain('decision-core observations');
    expect(mode.message).toContain('decision-core enforce');
  });

  it('reports ENFORCE mode as a pass', async () => {
    const ctx = makeCtx({ json: true }, { enforcementMode: 'enforce' });
    await doctorCommand(ctx);
    const mode = JSON.parse(ctx.output[0]).checks.find((c: { name: string }) => c.name === 'mode');
    expect(mode.status).toBe('pass');
    expect(mode.message).toContain('ENFORCE MODE');
  });
});
