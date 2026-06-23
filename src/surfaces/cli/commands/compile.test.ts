/**
 * compile command tests
 */

import { describe, it, expect } from 'vitest';
import { compileCommand } from './compile.js';
import type { CliContext } from '../cli.js';

function makeCtx(flags: Record<string, string | boolean> = {}): CliContext & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    config: undefined,
    flags,
    args: { command: 'compile', positionals: [], flags, subcommand: undefined },
    stdout: (msg: string) => output.push(msg),
    stderr: (msg: string) => errors.push(msg),
    output,
    errors,
  };
}

describe('compileCommand', () => {
  it('requires --clause-ids flag', async () => {
    const ctx = makeCtx({});
    const code = await compileCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.errors[0]).toContain('Usage');
  });

  it('compiles clause IDs and reports results', async () => {
    const ctx = makeCtx({ 'clause-ids': 'clause-1,clause-2' });
    const code = await compileCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.output[0]).toContain('Compilation complete');
  });

  it('outputs JSON when --json flag set', async () => {
    const ctx = makeCtx({ 'clause-ids': 'clause-1', json: true });
    const code = await compileCommand(ctx);
    expect(code).toBe(0);
    const parsed = JSON.parse(ctx.output[0]);
    expect(parsed).toHaveProperty('compiledRules');
    expect(parsed).toHaveProperty('ambiguousClauses');
    expect(parsed).toHaveProperty('errors');
  });
});
