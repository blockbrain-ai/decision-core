import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { importPolicySource } from './policy-source-importer.js';

const EXAMPLE_PATH = join(import.meta.dirname, '../../../config/examples/example-policy.md');

describe('PolicySourceImporter', () => {
  it('imports a Markdown file and computes source hash', async () => {
    const result = await importPolicySource(EXAMPLE_PATH);

    expect(result.source.content).toContain('# Anti-Money Laundering Policy');
    expect(result.source.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.source.importedAt).toBeTruthy();
    expect(result.isDuplicate).toBe(false);
  });

  it('extracts title from first heading', async () => {
    const result = await importPolicySource(EXAMPLE_PATH);
    expect(result.source.title).toBe('Anti-Money Laundering Policy');
  });

  it('uses custom title when provided', async () => {
    const result = await importPolicySource(EXAMPLE_PATH, { title: 'Custom Title' });
    expect(result.source.title).toBe('Custom Title');
  });

  it('detects duplicate when hash is in knownHashes', async () => {
    const first = await importPolicySource(EXAMPLE_PATH);
    const knownHashes = new Set([first.source.sourceHash]);

    const second = await importPolicySource(EXAMPLE_PATH, { knownHashes });
    expect(second.isDuplicate).toBe(true);
  });

  it('produces stable hash for same content', async () => {
    const first = await importPolicySource(EXAMPLE_PATH);
    const second = await importPolicySource(EXAMPLE_PATH);
    expect(first.source.sourceHash).toBe(second.source.sourceHash);
  });
});
