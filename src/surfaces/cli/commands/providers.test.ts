/**
 * providers command tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { stringify as stringifyYaml } from 'yaml';
import { providersCommand } from './providers.js';
import type { CliContext } from '../cli.js';

function makeCtx(
  flags: Record<string, string | boolean> = {},
  positionals: string[] = [],
  subcommand?: string,
): CliContext & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    config: undefined,
    flags,
    args: { command: 'providers', positionals, flags, subcommand },
    stdout: (msg: string) => output.push(msg),
    stderr: (msg: string) => errors.push(msg),
    output,
    errors,
  };
}

describe('providersCommand', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dc-providers-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('shows usage when no subcommand', async () => {
    const ctx = makeCtx({}, []);
    const code = await providersCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.errors[0]).toContain('Usage');
  });

  describe('init', () => {
    it('creates a profiles template file', async () => {
      const path = join(tempDir, 'profiles.yaml');
      const ctx = makeCtx({ profiles: path }, ['init'], 'init');
      const code = await providersCommand(ctx);
      expect(code).toBe(0);
      expect(ctx.output[0]).toContain('Created provider profiles template');
    });

    it('refuses to overwrite without --force', async () => {
      const path = join(tempDir, 'profiles.yaml');
      writeFileSync(path, 'existing');
      const ctx = makeCtx({ profiles: path }, ['init'], 'init');
      const code = await providersCommand(ctx);
      expect(code).toBe(1);
      expect(ctx.errors[0]).toContain('already exists');
    });
  });

  describe('list', () => {
    it('lists profiles from file', async () => {
      const path = join(tempDir, 'profiles.yaml');
      const profiles = [{
        providerId: 'test/model-1',
        modelId: 'model-1',
        adapter: 'disabled',
        purposes: ['general'],
        capabilities: ['structured-output'],
        dataBoundary: 'local',
        credentialSource: 'none',
        timeoutMs: 30000,
        maxRetries: 1,
      }];
      writeFileSync(path, stringifyYaml(profiles));

      const ctx = makeCtx({ profiles: path }, ['list'], 'list');
      const code = await providersCommand(ctx);
      expect(code).toBe(0);
      expect(ctx.output[0]).toContain('Provider profiles (1)');
    });

    it('outputs JSON when --json flag set', async () => {
      const path = join(tempDir, 'profiles.yaml');
      const profiles = [{
        providerId: 'test/model-1',
        modelId: 'model-1',
        adapter: 'disabled',
        purposes: ['general'],
        capabilities: ['structured-output'],
        dataBoundary: 'local',
        credentialSource: 'none',
        timeoutMs: 30000,
        maxRetries: 1,
      }];
      writeFileSync(path, stringifyYaml(profiles));

      const ctx = makeCtx({ profiles: path, json: true }, ['list'], 'list');
      const code = await providersCommand(ctx);
      expect(code).toBe(0);
      const parsed = JSON.parse(ctx.output[0]);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].providerId).toBe('test/model-1');
    });
  });

  describe('doctor', () => {
    it('validates profiles and reports issues', async () => {
      const path = join(tempDir, 'profiles.yaml');
      const profiles = [{
        providerId: 'test/direct-model',
        modelId: 'model-1',
        adapter: 'direct',
        purposes: ['general'],
        capabilities: [],
        dataBoundary: 'local',
        credentialSource: 'env-var',
        envVarName: 'NONEXISTENT_API_KEY_FOR_TEST',
        timeoutMs: 30000,
        maxRetries: 1,
      }];
      writeFileSync(path, stringifyYaml(profiles));

      const ctx = makeCtx({ profiles: path }, ['doctor'], 'doctor');
      const code = await providersCommand(ctx);
      expect(code).toBe(1);
      expect(ctx.output.join('\n')).toContain('NONEXISTENT_API_KEY_FOR_TEST');
    });

    it('reports all valid when profiles are correct', async () => {
      const path = join(tempDir, 'profiles.yaml');
      const profiles = [{
        providerId: 'test/host-model',
        modelId: 'model-1',
        adapter: 'host',
        purposes: ['general'],
        capabilities: ['structured-output'],
        dataBoundary: 'local',
        credentialSource: 'host-callback',
        timeoutMs: 30000,
        maxRetries: 1,
      }];
      writeFileSync(path, stringifyYaml(profiles));

      const ctx = makeCtx({ profiles: path }, ['doctor'], 'doctor');
      const code = await providersCommand(ctx);
      expect(code).toBe(0);
      expect(ctx.output[0]).toContain('pass validation');
    });
  });

  describe('explain-routing', () => {
    it('explains provider routing for a purpose', async () => {
      const path = join(tempDir, 'profiles.yaml');
      const profiles = [{
        providerId: 'test/model-1',
        modelId: 'model-1',
        adapter: 'host',
        purposes: ['general', 'tribunal'],
        capabilities: ['structured-output'],
        dataBoundary: 'local',
        credentialSource: 'host-callback',
        timeoutMs: 30000,
        maxRetries: 1,
      }];
      writeFileSync(path, stringifyYaml(profiles));

      const ctx = makeCtx({ profiles: path, purpose: 'tribunal' }, ['explain-routing'], 'explain-routing');
      const code = await providersCommand(ctx);
      expect(code).toBe(0);
      expect(ctx.output.join('\n')).toContain('test/model-1');
      expect(ctx.output.join('\n')).toContain('exact');
    });

    it('returns error for invalid purpose', async () => {
      const ctx = makeCtx({ purpose: 'invalid-purpose' }, ['explain-routing'], 'explain-routing');
      const code = await providersCommand(ctx);
      expect(code).toBe(1);
    });
  });
});
