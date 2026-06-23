import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { upgradeCommand } from './upgrade.js';
import type { CliContext } from '../cli.js';

function makeCtx(flags: Record<string, string | boolean> = {}): CliContext & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    config: undefined,
    flags,
    args: { command: 'upgrade', positionals: [], flags },
    stdout: (msg: string) => output.push(msg),
    stderr: (msg: string) => errors.push(msg),
    output,
    errors,
  };
}

describe('upgrade command', () => {
  let testDir: string;
  let origCwd: string;
  let packPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `dc-upgrade-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testDir, '.decision-core'), { recursive: true });
    packPath = join(testDir, '.decision-core', 'policy-pack.yaml');
    writeFileSync(packPath, stringifyYaml({
      version: '1.0.0',
      name: 'personal-starter',
      rules: [
        { name: 'allow-read', actionTypePattern: 'read_*', priority: 50 },
        { name: 'custom-rule', actionTypePattern: 'custom_*', priority: 60 },
      ],
    }), 'utf-8');
    origCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
  });

  it('adds enterprise rules', async () => {
    const ctx = makeCtx({ to: 'enterprise' });
    const code = await upgradeCommand(ctx);
    expect(code).toBe(0);

    const raw = readFileSync(packPath, 'utf-8');
    const parsed = parseYaml(raw);
    expect(parsed.rules.some((r: { name: string }) => r.name === 'enterprise-destructive-deny')).toBe(true);
    expect(parsed.rules.some((r: { name: string }) => r.name === 'enterprise-admin-approval')).toBe(true);
  });

  it('preserves custom rules', async () => {
    const ctx = makeCtx({ to: 'team' });
    await upgradeCommand(ctx);

    const raw = readFileSync(packPath, 'utf-8');
    const parsed = parseYaml(raw);
    expect(parsed.rules.some((r: { name: string }) => r.name === 'custom-rule')).toBe(true);
    expect(parsed.rules.some((r: { name: string }) => r.name === 'allow-read')).toBe(true);
  });

  it('skips rules that already exist', async () => {
    const ctx1 = makeCtx({ to: 'team' });
    await upgradeCommand(ctx1);
    const before = readFileSync(packPath, 'utf-8');
    const ruleCount = parseYaml(before).rules.length;

    const ctx2 = makeCtx({ to: 'team' });
    await upgradeCommand(ctx2);
    const after = readFileSync(packPath, 'utf-8');
    expect(parseYaml(after).rules.length).toBe(ruleCount);
  });

  it('rejects invalid target mode', async () => {
    const ctx = makeCtx({ to: 'invalid' });
    const code = await upgradeCommand(ctx);
    expect(code).toBe(1);
  });

  it('creates backup before upgrade', async () => {
    const ctx = makeCtx({ to: 'enterprise' });
    await upgradeCommand(ctx);
    const backupsDir = join(testDir, '.decision-core', 'backups');
    const { existsSync } = await import('fs');
    expect(existsSync(backupsDir)).toBe(true);
  });
});
