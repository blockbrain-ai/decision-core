import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { validateCommand } from './validate.js';
import type { CliContext, ParsedArgs } from '../cli.js';

function makeCtx(positionals: string[], flags: Record<string, string | boolean> = {}): { ctx: CliContext; output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  const args: ParsedArgs = { command: 'validate', positionals, flags };
  return {
    ctx: {
      config: undefined,
      flags,
      args,
      stdout: (msg) => output.push(msg),
      stderr: (msg) => errors.push(msg),
    },
    output,
    errors,
  };
}

describe('validateCommand', () => {
  it('validates a low-risk structured markdown template', async () => {
    const { ctx, output } = makeCtx([resolve(process.cwd(), 'config/templates/structured-clause-low-risk.md')]);
    const code = await validateCommand(ctx);
    expect(code).toBe(0);
    expect(output.some((l) => l.includes('Valid'))).toBe(true);
  });

  it('validates a YAML policy template', async () => {
    const { ctx, output } = makeCtx([resolve(process.cwd(), 'config/templates/programmatic-policy.yaml')]);
    const code = await validateCommand(ctx);
    expect(code).toBe(0);
    expect(output.some((l) => l.includes('Valid') || l.includes('valid'))).toBe(true);
  });

  it('outputs JSON with --json flag', async () => {
    const { ctx, output } = makeCtx(
      [resolve(process.cwd(), 'config/templates/structured-clause-low-risk.md')],
      { json: true },
    );
    const code = await validateCommand(ctx);
    expect(code).toBe(0);
    const parsed = JSON.parse(output.join('\n'));
    expect(parsed.valid).toBe(true);
    expect(parsed.clauseCount).toBeGreaterThan(0);
  });

  it('returns 1 when no file path given', async () => {
    const { ctx, errors } = makeCtx([]);
    const code = await validateCommand(ctx);
    expect(code).toBe(1);
    expect(errors.some((l) => l.includes('Usage'))).toBe(true);
  });

  it('returns 1 for nonexistent file', async () => {
    const { ctx, errors } = makeCtx(['/nonexistent/file.md']);
    const code = await validateCommand(ctx);
    expect(code).toBe(1);
    expect(errors.some((l) => l.includes('Cannot access'))).toBe(true);
  });
});
