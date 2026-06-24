import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { inspectPromote, flipToEnforce } from './promote-enforce.js';

function writeConfig(dir: string, enforcementMode: 'observe' | 'enforce', withPack = true): void {
  mkdirSync(join(dir, '.decision-core'), { recursive: true });
  if (withPack) {
    writeFileSync(join(dir, '.decision-core', 'policy-pack.yaml'), 'version: "1.0.0"\nname: t\nrules: []\n', 'utf-8');
  }
  const packLine = withPack ? 'policyPackPath: .decision-core/policy-pack.yaml\n' : '';
  writeFileSync(
    join(dir, 'decision-core.yaml'),
    `# comment kept\ntenantId: default\npersistence: sqlite\nsqlitePath: .decision-core/decisions.db\n${packLine}denyUnknownDefault: true\nenforcementMode: ${enforcementMode}\n`,
    'utf-8',
  );
}

describe('promote-enforce', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dc-enforce-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('inspect reports an observe config that can be promoted', () => {
    writeConfig(dir, 'observe');
    expect(inspectPromote(dir)).toEqual({ exists: true, valid: true, alreadyEnforcing: false, hasPack: true });
  });

  it('flips observe -> enforce, preserves comments, backs up, and validates', () => {
    writeConfig(dir, 'observe');
    const result = flipToEnforce(dir);
    expect(result.ok).toBe(true);
    if (result.ok && !result.alreadyEnforcing) {
      expect(result.from).toBe('observe');
      expect(result.to).toBe('enforce');
    }
    const after = readFileSync(join(dir, 'decision-core.yaml'), 'utf-8');
    expect(after).toContain('enforcementMode: enforce');
    expect(after).not.toContain('enforcementMode: observe');
    expect(after).toContain('# comment kept'); // line-level flip preserved the file
    // A backup was written under .decision-core.
    expect(existsSync(join(dir, '.decision-core'))).toBe(true);
  });

  it('is idempotent — already-enforcing returns alreadyEnforcing without writing', () => {
    writeConfig(dir, 'enforce');
    const result = flipToEnforce(dir);
    expect(result).toEqual({ ok: true, alreadyEnforcing: true });
  });

  it('refuses to enforce an empty policy (no pack)', () => {
    writeConfig(dir, 'observe', false);
    const result = flipToEnforce(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_pack');
    // config untouched
    expect(readFileSync(join(dir, 'decision-core.yaml'), 'utf-8')).toContain('enforcementMode: observe');
  });

  it('returns no_config when decision-core.yaml is absent', () => {
    const result = flipToEnforce(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_config');
  });
});
