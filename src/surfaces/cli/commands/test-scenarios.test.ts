import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { stringify as stringifyYaml } from 'yaml';
import { testScenariosCommand } from './test-scenarios.js';
import type { CliContext } from '../cli.js';

function makeCtx(flags: Record<string, string | boolean> = {}): CliContext & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    config: undefined,
    flags,
    args: { command: 'run-tests', positionals: [], flags },
    stdout: (msg: string) => output.push(msg),
    stderr: (msg: string) => errors.push(msg),
    output,
    errors,
  };
}

describe('test-scenarios command', () => {
  let testDir: string;
  let origCwd: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `dc-test-scenarios-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testDir, '.decision-core', 'tests'), { recursive: true });

    writeFileSync(join(testDir, '.decision-core', 'policy-pack.yaml'), stringifyYaml({
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

  it('passes scenarios with correct expectations', async () => {
    writeFileSync(join(testDir, '.decision-core', 'tests', 'generated-scenarios.json'), JSON.stringify([
      { name: 'read allowed', input: { action: 'read_file', surface: 'api' }, expected: 'allow' },
      { name: 'delete denied', input: { action: 'delete_db', surface: 'api' }, expected: 'deny' },
      { name: 'unknown denied', input: { action: 'unknown_tool', surface: 'api' }, expected: 'deny' },
    ]));

    const ctx = makeCtx();
    const code = await testScenariosCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.output.some(l => l.includes('3 passed'))).toBe(true);
  });

  it('fails scenarios with wrong expectations', async () => {
    writeFileSync(join(testDir, '.decision-core', 'tests', 'generated-scenarios.json'), JSON.stringify([
      { name: 'read should be deny', input: { action: 'read_file', surface: 'api' }, expected: 'deny' },
    ]));

    const ctx = makeCtx();
    const code = await testScenariosCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.output.some(l => l.includes('FAIL'))).toBe(true);
  });

  it('rejects legacy scenario format', async () => {
    writeFileSync(join(testDir, '.decision-core', 'tests', 'generated-scenarios.json'), JSON.stringify([
      { name: 'legacy', input: { action_type: 'tool_call', tool_name: 'read_file' }, expected: 'block' },
    ]));

    const ctx = makeCtx();
    const code = await testScenariosCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.errors[0]).toContain('legacy');
  });

  it('outputs JSON with --json flag', async () => {
    writeFileSync(join(testDir, '.decision-core', 'tests', 'generated-scenarios.json'), JSON.stringify([
      { name: 'read allowed', input: { action: 'read_file', surface: 'api' }, expected: 'allow' },
    ]));

    const ctx = makeCtx({ json: true });
    const code = await testScenariosCommand(ctx);
    expect(code).toBe(0);
    const parsed = JSON.parse(ctx.output[0]);
    expect(parsed.passed).toBe(1);
    expect(parsed.failed).toBe(0);
  });
});
