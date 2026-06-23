import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parse as parseYaml } from 'yaml';
import { initCommand } from './init.js';
import { PolicyPackSchema } from '../../sdk/types.js';
import { CliConfigSchema } from '../config-loader.js';
import type { CliContext } from '../cli.js';

function makeCtx(flags: Record<string, string | boolean> = {}): CliContext & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    config: undefined,
    flags,
    args: { command: 'init', positionals: [], flags },
    stdout: (msg: string) => output.push(msg),
    stderr: (msg: string) => errors.push(msg),
    output,
    errors,
  };
}

describe('init command', () => {
  let testDir: string;
  let origCwd: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `dc-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    origCwd = process.cwd();
    process.chdir(testDir);
  });

  // Restore cwd after each test to avoid polluting other tests
  afterEach(() => {
    process.chdir(origCwd);
  });

  it('creates decision-core.yaml and policy-pack.yaml', async () => {
    const ctx = makeCtx();
    const code = await initCommand(ctx);
    expect(code).toBe(0);

    expect(existsSync(join(testDir, 'decision-core.yaml'))).toBe(true);
    expect(existsSync(join(testDir, '.decision-core', 'policy-pack.yaml'))).toBe(true);
  });

  it('generated config parses against CliConfigSchema', async () => {
    const ctx = makeCtx();
    await initCommand(ctx);

    const raw = readFileSync(join(testDir, 'decision-core.yaml'), 'utf-8');
    const parsed = parseYaml(raw);
    const result = CliConfigSchema.safeParse(parsed);
    expect(result.success, `Config schema validation failed: ${result.error?.message}`).toBe(true);
  });

  it('generated pack parses against PolicyPackSchema', async () => {
    const ctx = makeCtx();
    await initCommand(ctx);

    const raw = readFileSync(join(testDir, '.decision-core', 'policy-pack.yaml'), 'utf-8');
    const parsed = parseYaml(raw);
    const result = PolicyPackSchema.safeParse(parsed);
    expect(result.success, `Pack schema validation failed: ${result.error?.message}`).toBe(true);
  });

  it('sets denyUnknownDefault: true by default', async () => {
    const ctx = makeCtx();
    await initCommand(ctx);

    const raw = readFileSync(join(testDir, '.decision-core', 'policy-pack.yaml'), 'utf-8');
    const parsed = parseYaml(raw);
    expect(parsed.denyUnknownDefault).toBe(true);
  });

  it('sets denyUnknownDefault: false with --allow-unknown', async () => {
    const ctx = makeCtx({ 'allow-unknown': true });
    await initCommand(ctx);

    const raw = readFileSync(join(testDir, '.decision-core', 'policy-pack.yaml'), 'utf-8');
    const parsed = parseYaml(raw);
    expect(parsed.denyUnknownDefault).toBe(false);
  });

  it('refuses to overwrite existing config without --force', async () => {
    writeFileSync(join(testDir, 'decision-core.yaml'), 'existing: true');
    const ctx = makeCtx();
    const code = await initCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.errors[0]).toContain('already exists');
  });

  it('overwrites with --force', async () => {
    writeFileSync(join(testDir, 'decision-core.yaml'), 'existing: true');
    const ctx = makeCtx({ force: true });
    const code = await initCommand(ctx);
    expect(code).toBe(0);
  });

  it('rejects invalid profile', async () => {
    const ctx = makeCtx({ profile: 'invalid' });
    const code = await initCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.errors[0]).toContain('Invalid profile');
  });

  it('enterprise profile includes deny-destructive rule', async () => {
    const ctx = makeCtx({ profile: 'enterprise' });
    await initCommand(ctx);

    const raw = readFileSync(join(testDir, '.decision-core', 'policy-pack.yaml'), 'utf-8');
    const parsed = parseYaml(raw);
    const denyRule = parsed.rules.find((r: { name: string }) => r.name === 'deny-destructive');
    expect(denyRule).toBeDefined();
    expect(denyRule.defaultVerdict).toBe('deny');
  });

  it('team profile includes approve-destructive rule', async () => {
    const ctx = makeCtx({ profile: 'team' });
    await initCommand(ctx);

    const raw = readFileSync(join(testDir, '.decision-core', 'policy-pack.yaml'), 'utf-8');
    const parsed = parseYaml(raw);
    const approveRule = parsed.rules.find((r: { name: string }) => r.name === 'approve-destructive');
    expect(approveRule).toBeDefined();
    expect(approveRule.requireApproval).toBe(true);
  });

  it('outputs JSON with --json flag', async () => {
    const ctx = makeCtx({ json: true });
    await initCommand(ctx);
    const output = JSON.parse(ctx.output[0]);
    expect(output.profile).toBe('personal');
    expect(output.denyUnknownDefault).toBe(true);
  });
});
