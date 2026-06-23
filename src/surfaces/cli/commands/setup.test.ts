import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setupCommand } from './setup.js';
import type { CliContext } from '../cli.js';

function makeCtx(flags: Record<string, string | boolean> = {}): {
  ctx: CliContext;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    ctx: {
      config: undefined,
      flags,
      args: { command: 'setup', positionals: [], flags },
      stdout: (msg: string) => stdout.push(msg),
      stderr: (msg: string) => stderr.push(msg),
    },
    stdout,
    stderr,
  };
}

describe('setup command', () => {
  let tmpDir: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dc-setup-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs dry-run with personal profile and JSON output', async () => {
    const outputDir = join(tmpDir, 'out');
    const { ctx, stdout } = makeCtx({
      'agent': 'generic',
      'profile': 'personal',
      'memory-source': 'none',
      'dry-run': true,
      'json': true,
      'output': outputDir,
    });

    const code = await setupCommand(ctx);
    expect(code).toBe(0);

    const output = JSON.parse(stdout[stdout.length - 1]);
    expect(output.mode).toBe('personal');
    expect(output.artifactCount).toBeGreaterThan(0);
    expect(output.profileHash).toBeTruthy();
    expect(output.artifacts).toBeDefined();
    expect(output.detection).toBeDefined();
    expect(existsSync(outputDir)).toBe(false);
  });

  it('writes artifacts to output directory', async () => {
    const outputDir = join(tmpDir, 'artifacts');
    const { ctx } = makeCtx({
      'agent': 'generic',
      'profile': 'personal',
      'output': outputDir,
    });

    const code = await setupCommand(ctx);
    expect(code).toBe(0);
    expect(existsSync(join(outputDir, 'decision-core.profile.yaml'))).toBe(true);
    expect(existsSync(join(outputDir, 'decision-core.config.yaml'))).toBe(true);
    expect(existsSync(join(outputDir, 'policies', '000-baseline.md'))).toBe(true);
    expect(existsSync(join(outputDir, 'rollback-manifest.json'))).toBe(true);
  });

  it('respects --profile business flag', async () => {
    const outputDir = join(tmpDir, 'biz');
    const { ctx, stdout } = makeCtx({
      'agent': 'openclaw',
      'profile': 'business',
      'dry-run': true,
      'json': true,
      'output': outputDir,
    });

    const code = await setupCommand(ctx);
    expect(code).toBe(0);

    const output = JSON.parse(stdout[stdout.length - 1]);
    expect(output.mode).toBe('business');
    expect(output.provider).toBe('host');
  });

  it('honors --memory-source none by suppressing detected memory sources', async () => {
    const outputDir = join(tmpDir, 'memory-none');
    const { ctx, stdout } = makeCtx({
      'agent': 'generic',
      'profile': 'personal',
      'memory-source': 'none',
      'dry-run': true,
      'json': true,
      'output': outputDir,
    });

    const code = await setupCommand(ctx);
    expect(code).toBe(0);

    const output = JSON.parse(stdout[stdout.length - 1]);
    expect(output.detection.memorySources).toEqual([]);
  });

  it('respects --provider flag', async () => {
    const outputDir = join(tmpDir, 'prov');
    const { ctx, stdout } = makeCtx({
      'agent': 'generic',
      'profile': 'personal',
      'provider': 'direct',
      'dry-run': true,
      'json': true,
      'output': outputDir,
    });

    const code = await setupCommand(ctx);
    expect(code).toBe(0);

    const output = JSON.parse(stdout[stdout.length - 1]);
    expect(output.profile.provider.mode).toBe('direct');
  });

  it('imports memory evidence from file', async () => {
    const evidencePath = join(tmpDir, 'evidence.json');
    writeFileSync(evidencePath, JSON.stringify({
      schemaVersion: 1,
      sourceId: 'test-gbrain',
      sourceKind: 'gbrain',
      collectedBy: 'user-agent',
      collectedAt: '2026-01-01T00:00:00.000Z',
      consent: { readGranted: true, writeBackGranted: false, scope: ['onboarding'] },
      items: [
        {
          id: 'ev-1',
          summary: 'Agent manages enterprise operations for a large business',
          sourceRef: 'gbrain://test',
          confidence: 0.9,
          sensitive: false,
          suggestedProfilePatch: { mode: 'business' },
        },
      ],
    }));

    const outputDir = join(tmpDir, 'evidenced');
    const { ctx } = makeCtx({
      'agent': 'generic',
      'profile': 'auto',
      'memory-export': evidencePath,
      'dry-run': true,
      'json': true,
      'output': outputDir,
    });

    const code = await setupCommand(ctx);
    expect(code).toBe(0);
  });

  it('handles missing evidence file gracefully', async () => {
    const { ctx } = makeCtx({
      'agent': 'generic',
      'profile': 'personal',
      'memory-export': '/nonexistent/file.json',
      'dry-run': true,
      'output': join(tmpDir, 'out'),
    });

    const code = await setupCommand(ctx);
    expect(code).toBe(0);
  });

  it('does not write secrets to artifacts', async () => {
    const outputDir = join(tmpDir, 'secrets-check');
    const { ctx } = makeCtx({
      'agent': 'generic',
      'profile': 'personal',
      'output': outputDir,
    });

    await setupCommand(ctx);

    const baseline = readFileSync(join(outputDir, 'policies', '000-baseline.md'), 'utf-8');
    expect(baseline).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    expect(baseline).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });

  it('returns structured JSON in json mode', async () => {
    const outputDir = join(tmpDir, 'json-out');
    const { ctx, stdout } = makeCtx({
      'agent': 'hermes',
      'profile': 'team',
      'json': true,
      'output': outputDir,
    });

    const code = await setupCommand(ctx);
    expect(code).toBe(0);

    const output = JSON.parse(stdout[stdout.length - 1]);
    expect(output.profileId).toBeTruthy();
    expect(output.mode).toBe('team');
    expect(output.artifactCount).toBeGreaterThan(0);
  });
});
