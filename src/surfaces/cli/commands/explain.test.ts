/**
 * explain command tests
 */

import { describe, it, expect } from 'vitest';
import { explainCommand } from './explain.js';
import type { CliContext } from '../cli.js';

function makeCtx(flags: Record<string, string | boolean> = {}, positionals: string[] = []): CliContext & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    config: undefined,
    flags,
    args: { command: 'explain', positionals, flags, subcommand: undefined },
    stdout: (msg: string) => output.push(msg),
    stderr: (msg: string) => errors.push(msg),
    output,
    errors,
  };
}

describe('explainCommand', () => {
  it('requires a correlationId argument', async () => {
    const ctx = makeCtx({}, []);
    const code = await explainCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.errors[0]).toContain('Usage');
  });

  it('explains a decision by correlation ID', async () => {
    const ctx = makeCtx({}, ['test-correlation-id']);
    const code = await explainCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.output[0]).toContain('Explanation for: test-correlation-id');
  });

  it('outputs JSON when --json flag set', async () => {
    const ctx = makeCtx({ json: true }, ['test-correlation-id']);
    const code = await explainCommand(ctx);
    expect(code).toBe(0);
    const parsed = JSON.parse(ctx.output[0]);
    expect(parsed).toHaveProperty('correlationId');
    expect(parsed).toHaveProperty('records');
  });
});
