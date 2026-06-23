/**
 * ingest command tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ingestCommand } from './ingest.js';
import type { CliContext } from '../cli.js';

function makeCtx(flags: Record<string, string | boolean> = {}, positionals: string[] = []): CliContext & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    config: undefined,
    flags,
    args: { command: 'ingest', positionals, flags, subcommand: undefined },
    stdout: (msg: string) => output.push(msg),
    stderr: (msg: string) => errors.push(msg),
    output,
    errors,
  };
}

describe('ingestCommand', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dc-ingest-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('requires a file path argument', async () => {
    const ctx = makeCtx({}, []);
    const code = await ingestCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.errors[0]).toContain('Usage');
  });

  it('ingests a valid policy document', async () => {
    const policyPath = join(tempDir, 'policy.md');
    writeFileSync(policyPath, [
      '# Test Policy',
      '',
      '## Section A',
      '',
      'All transactions above $10,000 require dual authorization.',
      '',
      '## Section B',
      '',
      'Deployments to production are prohibited on weekends.',
    ].join('\n'));

    const ctx = makeCtx({}, [policyPath]);
    const code = await ingestCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.output[0]).toContain('Ingested: Test Policy');
  });

  it('outputs JSON when --json flag set', async () => {
    const policyPath = join(tempDir, 'policy.md');
    writeFileSync(policyPath, '# Simple Policy\n\nNo high-risk actions permitted.\n');

    const ctx = makeCtx({ json: true }, [policyPath]);
    const code = await ingestCommand(ctx);
    expect(code).toBe(0);
    const parsed = JSON.parse(ctx.output[0]);
    expect(parsed).toHaveProperty('title');
    expect(parsed).toHaveProperty('sections');
  });
});
