/**
 * evaluate command tests
 */

import { describe, it, expect } from 'vitest';
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
});
