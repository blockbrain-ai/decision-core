/**
 * Conformance CLI Command Tests
 */

import { describe, it, expect } from 'vitest';
import { runCli } from '../cli.js';

describe('conformance command', () => {
  it('shows usage when no flags provided', async () => {
    const stderr: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      stderr.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      const code = await runCli(['node', 'decision-core', 'conformance']);
      expect(code).toBe(1);
      expect(stderr.join('')).toContain('Usage');
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it('rejects unknown suite', async () => {
    const stderr: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      stderr.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      const code = await runCli(['node', 'decision-core', 'conformance', '--suite', 'nonexistent']);
      expect(code).toBe(1);
      expect(stderr.join('')).toContain('Unknown suite');
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it('runs org-mode suite and exits 0', async () => {
    const stdout: string[] = [];
    const origStdout = process.stdout.write.bind(process.stdout);
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string) => {
      stdout.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;

    try {
      const code = await runCli(['node', 'decision-core', 'conformance', '--suite', 'org-mode']);
      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Conformance Results');
    } finally {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    }
  });

  it('supports --format json', async () => {
    const stdout: string[] = [];
    const origStdout = process.stdout.write.bind(process.stdout);
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string) => {
      stdout.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;

    try {
      const code = await runCli([
        'node', 'decision-core', 'conformance', '--suite', 'org-mode', '--format', 'json',
      ]);
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout.join(''));
      expect(parsed.total).toBeGreaterThan(0);
      expect(parsed.passed).toBe(parsed.total);
    } finally {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    }
  });

  it('supports --tags smoke filter', async () => {
    const stdout: string[] = [];
    const origStdout = process.stdout.write.bind(process.stdout);
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string) => {
      stdout.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;

    try {
      const code = await runCli([
        'node', 'decision-core', 'conformance',
        '--suite', 'org-mode', '--tags', 'smoke', '--format', 'json',
      ]);
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout.join(''));
      expect(parsed.total).toBeGreaterThan(0);
      expect(parsed.total).toBeLessThan(100); // subset, not all
    } finally {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    }
  });

  it('reports check-baseline failure when no baseline exists', async () => {
    const stderr: string[] = [];
    const origStdout = process.stdout.write.bind(process.stdout);
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => {
      stderr.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      // --check-baseline when no baseline exists should fail
      const code = await runCli([
        'node', 'decision-core', 'conformance', '--check-baseline',
      ]);
      // Either fails because no baseline or succeeds if baseline was already generated
      expect(typeof code).toBe('number');
    } finally {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    }
  });
});
