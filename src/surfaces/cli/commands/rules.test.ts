import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { rulesCommand } from './rules.js';
import { addRuleCommand } from './add-rule.js';
import type { CliContext } from '../cli.js';

function makeCtx(flags: Record<string, string | boolean> = {}, subcommand?: string): CliContext & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    config: undefined,
    flags,
    args: { command: 'rules', subcommand, positionals: subcommand ? [subcommand] : [], flags },
    stdout: (msg: string) => output.push(msg),
    stderr: (msg: string) => errors.push(msg),
    output,
    errors,
  };
}

describe('rules command', () => {
  let testDir: string;
  let origCwd: string;
  let packPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `dc-rules-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testDir, '.decision-core'), { recursive: true });
    packPath = join(testDir, '.decision-core', 'policy-pack.yaml');
    writeFileSync(packPath, stringifyYaml({
      version: '1.0.0',
      name: 'test-pack',
      denyUnknownDefault: true,
      rules: [
        { name: 'allow-read', actionTypePattern: 'read_*', priority: 50 },
        { name: 'deny-delete', actionTypePattern: 'delete_*', priority: 90, defaultVerdict: 'deny' },
      ],
    }), 'utf-8');
    origCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
  });

  it('lists rules', async () => {
    const ctx = makeCtx({}, 'list');
    const code = await rulesCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.output.some(l => l.includes('allow-read'))).toBe(true);
    expect(ctx.output.some(l => l.includes('deny-delete'))).toBe(true);
  });

  it('lists rules as JSON', async () => {
    const ctx = makeCtx({ json: true }, 'list');
    const code = await rulesCommand(ctx);
    expect(code).toBe(0);
    const parsed = JSON.parse(ctx.output[0]);
    expect(parsed).toHaveLength(2);
  });

  it('adds a new rule', async () => {
    const ctx = makeCtx({ name: 'block-deploy', 'action-pattern': 'deploy_*', verdict: 'deny' }, 'add');
    const code = await rulesCommand(ctx);
    expect(code).toBe(0);

    const raw = readFileSync(packPath, 'utf-8');
    const parsed = parseYaml(raw);
    expect(parsed.rules).toHaveLength(3);
    expect(parsed.rules[2].name).toBe('block-deploy');
    expect(parsed.rules[2].defaultVerdict).toBe('deny');
  });

  it('rejects duplicate rule name', async () => {
    const ctx = makeCtx({ name: 'allow-read', 'action-pattern': 'read_*', verdict: 'allow' }, 'add');
    const code = await rulesCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.errors[0]).toContain('already exists');
  });

  it('disables a rule', async () => {
    const ctx = makeCtx({}, 'disable');
    ctx.args.positionals = ['disable', 'allow-read'];
    const code = await rulesCommand(ctx);
    expect(code).toBe(0);

    const raw = readFileSync(packPath, 'utf-8');
    const parsed = parseYaml(raw);
    const rule = parsed.rules.find((r: { name: string }) => r.name === 'allow-read');
    expect(rule.enabled).toBe(false);
  });

  it('enables a rule', async () => {
    // First disable
    const disableCtx = makeCtx({}, 'disable');
    disableCtx.args.positionals = ['disable', 'allow-read'];
    await rulesCommand(disableCtx);

    // Then enable
    const enableCtx = makeCtx({}, 'enable');
    enableCtx.args.positionals = ['enable', 'allow-read'];
    const code = await rulesCommand(enableCtx);
    expect(code).toBe(0);

    const raw = readFileSync(packPath, 'utf-8');
    const parsed = parseYaml(raw);
    const rule = parsed.rules.find((r: { name: string }) => r.name === 'allow-read');
    expect(rule.enabled).toBe(true);
  });

  it('creates backup before add', async () => {
    const ctx = makeCtx({ name: 'test-rule', 'action-pattern': 'test_*', verdict: 'allow' }, 'add');
    await rulesCommand(ctx);
    expect(existsSync(join(testDir, '.decision-core', 'backups'))).toBe(true);
  });
});

describe('add-rule alias', () => {
  let testDir: string;
  let origCwd: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `dc-add-rule-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testDir, '.decision-core'), { recursive: true });
    writeFileSync(join(testDir, '.decision-core', 'policy-pack.yaml'), stringifyYaml({
      version: '1.0.0',
      name: 'test-pack',
      rules: [{ name: 'existing', actionTypePattern: 'existing_*', priority: 50 }],
    }), 'utf-8');
    origCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
  });

  it('add-rule command adds a rule via alias', async () => {
    const ctx = makeCtx({ name: 'via-alias', 'action-pattern': 'alias_*', verdict: 'allow' });
    const code = await addRuleCommand(ctx);
    expect(code).toBe(0);
  });
});
