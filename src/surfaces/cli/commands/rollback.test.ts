import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createBackup } from '../backup-utils.js';
import { rollbackCommand } from './rollback.js';
import type { CliContext } from '../cli.js';

function makeCtx(flags: Record<string, string | boolean> = {}): CliContext & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    config: undefined,
    flags,
    args: { command: 'rollback', positionals: [], flags },
    stdout: (msg: string) => output.push(msg),
    stderr: (msg: string) => errors.push(msg),
    output,
    errors,
  };
}

describe('rollback command', () => {
  let testDir: string;
  let origCwd: string;
  let dcDir: string;
  let packPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `dc-rollback-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dcDir = join(testDir, '.decision-core');
    mkdirSync(dcDir, { recursive: true });
    packPath = join(dcDir, 'policy-pack.yaml');
    writeFileSync(packPath, 'version: original', 'utf-8');
    origCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  it('--list shows no backups when none exist', async () => {
    const ctx = makeCtx({ list: true });
    const code = await rollbackCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.output[0]).toContain('No backups');
  });

  it('--list shows available backups', async () => {
    createBackup([packPath], 'test-cmd', dcDir);
    const ctx = makeCtx({ list: true });
    const code = await rollbackCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.output.some(l => l.includes('test-cmd'))).toBe(true);
  });

  it('--last restores previous file content', async () => {
    createBackup([packPath], 'before-change', dcDir);
    writeFileSync(packPath, 'version: modified', 'utf-8');

    const ctx = makeCtx({ last: true });
    const code = await rollbackCommand(ctx);
    expect(code).toBe(0);

    const restored = readFileSync(packPath, 'utf-8');
    expect(restored).toBe('version: original');
  });

  it('--last fails when no backups exist', async () => {
    const ctx = makeCtx({ last: true });
    const code = await rollbackCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.errors[0]).toContain('No backups');
  });

  it('shows usage without flags', async () => {
    const ctx = makeCtx();
    const code = await rollbackCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.errors[0]).toContain('Usage');
  });
});
