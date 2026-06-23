import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { orgCommand } from './org.js';
import type { CliContext } from '../cli.js';

function makeCtx(
  subcommand: string,
  flags: Record<string, string | boolean> = {},
): CliContext & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    config: undefined,
    flags,
    args: { command: 'org', subcommand, positionals: [subcommand], flags },
    stdout: (msg: string) => output.push(msg),
    stderr: (msg: string) => errors.push(msg),
    output,
    errors,
  };
}

describe('org command', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'dc-org-'));
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  it('org init creates the starter files', async () => {
    const ctx = makeCtx('init', { profile: 'small-business' });

    const code = await orgCommand(ctx);

    expect(code).toBe(0);
    expect(existsSync(join(testDir, '.decision-core', 'agents.yaml'))).toBe(true);
    expect(existsSync(join(testDir, '.decision-core', 'access-policy.yaml'))).toBe(true);
    expect(existsSync(join(testDir, '.decision-core', 'policy-pack.yaml'))).toBe(true);
    expect(existsSync(join(testDir, '.decision-core', 'tool-inventory.yaml'))).toBe(true);
  });
});
