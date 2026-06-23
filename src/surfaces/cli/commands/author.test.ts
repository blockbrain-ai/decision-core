/**
 * Author CLI Command Tests
 *
 * Tests the non-interactive modes of the policy author CLI command.
 */

import { describe, it, expect } from 'vitest';
import { runCli } from '../cli.js';

describe('CLI: author command', () => {
  it('generates rules from --text flag', async () => {
    const output: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((msg: string) => {
      output.push(msg);
      return true;
    }) as typeof process.stdout.write;

    try {
      const exitCode = await runCli([
        'node', 'decision-core',
        'author',
        '--text', 'nobody should drop the database',
        '--json',
      ]);

      expect(exitCode).toBe(0);
      const combined = output.join('');
      const parsed = JSON.parse(combined);
      expect(parsed.candidateRules).toBeDefined();
      expect(parsed.candidateRules.length).toBeGreaterThan(0);
      expect(parsed.candidateRules[0].yamlContent).toContain('enabled: false');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('returns error for missing document', async () => {
    const errors: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((msg: string) => {
      errors.push(msg);
      return true;
    }) as typeof process.stderr.write;

    try {
      const exitCode = await runCli([
        'node', 'decision-core',
        'author',
        '--document', '/nonexistent/file.md',
      ]);

      expect(exitCode).toBe(1);
      expect(errors.join('')).toContain('not found');
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it('shows author in help output', async () => {
    const output: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((msg: string) => {
      output.push(msg);
      return true;
    }) as typeof process.stdout.write;

    try {
      await runCli(['node', 'decision-core', 'help']);
      const combined = output.join('');
      expect(combined).toContain('author');
      expect(combined).toContain('policy rules from natural language');
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
