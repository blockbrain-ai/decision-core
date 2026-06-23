/**
 * Config Loader Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadCliConfig } from './config-loader.js';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('loadCliConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dc-cli-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('returns undefined when no config file found at default path', () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const result = loadCliConfig();
      expect(result).toBeUndefined();
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('loads config from explicit path', () => {
    const configPath = join(tempDir, 'test-config.yaml');
    writeFileSync(configPath, 'tenantId: my-tenant\npersistence: memory\n');

    const result = loadCliConfig(configPath);
    expect(result).toBeDefined();
    expect(result!.tenantId).toBe('my-tenant');
    expect(result!.persistence).toBe('memory');
  });

  it('throws when explicit config path does not exist', () => {
    expect(() => loadCliConfig('/nonexistent/path.yaml')).toThrow('Config file not found');
  });

  it('throws on invalid config content', () => {
    const configPath = join(tempDir, 'bad.yaml');
    writeFileSync(configPath, 'persistence: invalid_value\n');

    expect(() => loadCliConfig(configPath)).toThrow('Invalid config file');
  });

  it('parses full config with nested sections', () => {
    const configPath = join(tempDir, 'full.yaml');
    writeFileSync(configPath, [
      'tenantId: enterprise-1',
      'persistence: memory',
      'tenantMode: multi',
      'policyPackPath: ./policies.yaml',
      'provider:',
      '  mode: local',
      '  profilesPath: ./profiles.yaml',
      'trust:',
      '  policyPath: ./trust.json',
      'serve:',
      '  host: 0.0.0.0',
      '  port: 3000',
      '  mcp: true',
    ].join('\n'));

    const result = loadCliConfig(configPath);
    expect(result!.tenantId).toBe('enterprise-1');
    expect(result!.tenantMode).toBe('multi');
    expect(result!.provider?.mode).toBe('local');
    expect(result!.provider?.profilesPath).toBe('./profiles.yaml');
    expect(result!.trust?.policyPath).toBe('./trust.json');
    expect(result!.serve?.host).toBe('0.0.0.0');
    expect(result!.serve?.port).toBe(3000);
    expect(result!.serve?.mcp).toBe(true);
  });
});
