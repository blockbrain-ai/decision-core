import { describe, it, expect } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { generateTestsCommand } from './generate-tests.js';
import type { CliContext, ParsedArgs } from '../cli.js';

function makeCtx(positionals: string[], flags: Record<string, string | boolean> = {}): { ctx: CliContext; output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  const args: ParsedArgs = { command: 'generate-tests', positionals, flags };
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

const SAMPLE_RULES = [
  {
    id: 'rule-1',
    clauseId: 'clause-1',
    controlId: null,
    ruleType: 'threshold',
    expression: { type: 'threshold', field: 'amount', operator: 'gte', value: 1000 },
    description: 'Amount >= 1000',
    compiledAt: '2026-01-01T00:00:00Z',
  },
];

describe('generateTestsCommand', () => {
  const tmpFile = resolve(tmpdir(), `dc-test-rules-${Date.now()}.json`);

  it('generates test cases from rule set file', async () => {
    writeFileSync(tmpFile, JSON.stringify(SAMPLE_RULES), 'utf-8');
    const { ctx, output } = makeCtx([], { 'rule-set': tmpFile });
    const code = await generateTestsCommand(ctx);
    expect(code).toBe(0);
    const scenarios = JSON.parse(output.join('\n'));
    expect(Array.isArray(scenarios)).toBe(true);
    expect(scenarios.length).toBeGreaterThan(0);
    unlinkSync(tmpFile);
  });

  it('accepts positional argument as rule set path', async () => {
    writeFileSync(tmpFile, JSON.stringify(SAMPLE_RULES), 'utf-8');
    const { ctx, output } = makeCtx([tmpFile]);
    const code = await generateTestsCommand(ctx);
    expect(code).toBe(0);
    const scenarios = JSON.parse(output.join('\n'));
    expect(scenarios.length).toBeGreaterThan(0);
    unlinkSync(tmpFile);
  });

  it('returns 1 when no path given', async () => {
    const { ctx, errors } = makeCtx([]);
    const code = await generateTestsCommand(ctx);
    expect(code).toBe(1);
    expect(errors.some((l) => l.includes('Usage'))).toBe(true);
  });

  it('returns 1 for nonexistent file', async () => {
    const { ctx, errors } = makeCtx([], { 'rule-set': '/nonexistent/rules.json' });
    const code = await generateTestsCommand(ctx);
    expect(code).toBe(1);
    expect(errors.some((l) => l.includes('Cannot load'))).toBe(true);
  });
});
