import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { findBundledConfigDir, resolveBundledConfigPath } from './bundled-paths.js';

describe('bundled-paths', () => {
  it('finds package-root config when starting from a source tree path', () => {
    const root = mkdtempSync(join(tmpdir(), 'dc-bundled-src-'));
    try {
      mkdirSync(join(root, 'config', 'packs'), { recursive: true });
      mkdirSync(join(root, 'src', 'surfaces', 'cli', 'commands'), { recursive: true });

      const startDir = join(root, 'src', 'surfaces', 'cli', 'commands');
      expect(findBundledConfigDir(startDir)).toBe(join(root, 'config'));
      expect(resolveBundledConfigPath(startDir, 'packs', 'team.yaml')).toBe(join(root, 'config', 'packs', 'team.yaml'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to package-root config when dist/config is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'dc-bundled-dist-'));
    try {
      mkdirSync(join(root, 'config', 'surface-contracts'), { recursive: true });
      mkdirSync(join(root, 'dist', 'src', 'surfaces', 'sdk'), { recursive: true });

      const startDir = join(root, 'dist', 'src', 'surfaces', 'sdk');
      expect(findBundledConfigDir(startDir)).toBe(join(root, 'config'));
      expect(resolveBundledConfigPath(startDir, 'surface-contracts', 'default.yaml')).toBe(
        join(root, 'config', 'surface-contracts', 'default.yaml'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prefers dist/config when it exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'dc-bundled-dist-pref-'));
    try {
      mkdirSync(join(root, 'config', 'packs'), { recursive: true });
      mkdirSync(join(root, 'dist', 'config', 'packs'), { recursive: true });
      mkdirSync(join(root, 'dist', 'src', 'packs'), { recursive: true });

      const startDir = join(root, 'dist', 'src', 'packs');
      expect(findBundledConfigDir(startDir)).toBe(join(root, 'dist', 'config'));
      expect(resolveBundledConfigPath(startDir, 'packs', 'personal.yaml')).toBe(
        join(root, 'dist', 'config', 'packs', 'personal.yaml'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
