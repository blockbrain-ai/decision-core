import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { lintCommand } from './lint.js';
import type { CliContext, ParsedArgs } from '../cli.js';

function makeCtx(positionals: string[], flags: Record<string, string | boolean> = {}): { ctx: CliContext; output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  const args: ParsedArgs = { command: 'lint', positionals, flags };
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

describe('lintCommand', () => {
  it('lints a clean low-risk template with no errors', async () => {
    const { ctx, output } = makeCtx(
      [resolve(process.cwd(), 'config/templates/structured-clause-low-risk.md')],
      { 'surface-contracts': resolve(process.cwd(), 'config/surface-contracts/default.yaml') },
    );
    const code = await lintCommand(ctx);
    expect(code).toBe(0);
    expect(output.some((l) => l.includes('0 error') || l.includes('No issues'))).toBe(true);
  });

  it('returns JSON with --json flag', async () => {
    const { ctx, output } = makeCtx(
      [resolve(process.cwd(), 'config/templates/structured-clause-low-risk.md')],
      { json: true, 'surface-contracts': resolve(process.cwd(), 'config/surface-contracts/default.yaml') },
    );
    const code = await lintCommand(ctx);
    expect(code).toBe(0);
    const report = JSON.parse(output.join('\n'));
    expect(report.errorCount).toBe(0);
    expect(report.diagnostics).toBeDefined();
  });

  it('returns 1 when no path given', async () => {
    const { ctx, errors } = makeCtx([]);
    const code = await lintCommand(ctx);
    expect(code).toBe(1);
    expect(errors.some((l) => l.includes('Usage'))).toBe(true);
  });

  it('filters by severity', async () => {
    const { ctx, output } = makeCtx(
      [resolve(process.cwd(), 'config/templates/structured-clause-high-risk.md')],
      { severity: 'error', 'surface-contracts': resolve(process.cwd(), 'config/surface-contracts/default.yaml') },
    );
    await lintCommand(ctx);
    const hasWarning = output.some((l) => l.startsWith('WARNING'));
    expect(hasWarning).toBe(false);
  });
});
