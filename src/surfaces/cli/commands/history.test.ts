import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateCommand } from './evaluate.js';
import { historyCommand } from './history.js';
import type { CliContext } from '../cli.js';
import { isBetterSqlite3Available } from '../../../persistence/sqlite/sqlite-availability.js';

function makeCtx(overrides: Partial<CliContext>): CliContext & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    config: undefined,
    flags: {},
    args: { command: 'test', positionals: [], flags: {}, subcommand: undefined },
    stdout: (msg: string) => output.push(msg),
    stderr: (msg: string) => errors.push(msg),
    output,
    errors,
    ...overrides,
  };
}

describe('history command', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!isBetterSqlite3Available())('shows decisions written by CLI evaluate when SQLite is configured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-history-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.decision-core'), { recursive: true });

    const packPath = join(dir, '.decision-core', 'policy-pack.yaml');
    const sqlitePath = join(dir, 'decisions.db');
    writeFileSync(packPath, `
version: "1.0.0"
name: "history-test"
denyUnknownDefault: true
rules:
  - name: "allow-read"
    actionTypePattern: "read_*"
    priority: 50
`, 'utf-8');

    const config = {
      tenantId: 'default',
      persistence: 'sqlite' as const,
      tenantMode: 'single' as const,
      policyPackPath: packPath,
      sqlitePath,
      denyUnknownDefault: true,
    };

    const evalCtx = makeCtx({
      config,
      flags: { surface: 'api', action: 'read_file', json: true },
      args: { command: 'evaluate', positionals: [], flags: { surface: 'api', action: 'read_file', json: true }, subcommand: undefined },
    });
    expect(await evaluateCommand(evalCtx)).toBe(0);

    const historyCtx = makeCtx({
      config,
      flags: { json: true },
      args: { command: 'history', positionals: [], flags: { json: true }, subcommand: undefined },
    });
    expect(await historyCommand(historyCtx)).toBe(0);

    const records = JSON.parse(historyCtx.output[0]);
    expect(records).toHaveLength(1);
    expect(records[0].toolName).toBe('read_file');
    expect(records[0].status).toBe('generated');
  });
});
