/**
 * serve command tests
 *
 * Tests that the HTTP server starts and responds to shutdown.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { serveCommand } from './serve.js';
import type { CliContext } from '../cli.js';

function makeCtx(flags: Record<string, string | boolean> = {}): CliContext & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    config: undefined,
    flags,
    args: { command: 'serve', positionals: [], flags, subcommand: undefined },
    stdout: (msg: string) => output.push(msg),
    stderr: (msg: string) => errors.push(msg),
    output,
    errors,
  };
}

describe('serveCommand', () => {
  const cleanupFns: Array<() => void> = [];

  afterEach(() => {
    for (const fn of cleanupFns) fn();
    cleanupFns.length = 0;
  });

  it('requires an HTTP bearer token by default', async () => {
    const ctx = makeCtx({ port: '0' });

    const code = await serveCommand(ctx);

    expect(code).toBe(1);
    expect(ctx.errors.join('\n')).toContain('HTTP serve requires authentication');
    expect(ctx.output.join('\n')).not.toContain('Decision Core HTTP server listening on');
  });

  it('starts HTTP server and reports address', async () => {
    const ctx = makeCtx({ port: '0', 'bearer-token': 'test-secret-token' });

    // Run serve — it blocks on signal, so we drive it ourselves
    const servePromise = serveCommand(ctx);

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(ctx.output.length).toBeGreaterThan(0);
    expect(ctx.output.join('\n')).toContain('Decision Core HTTP server listening on');
    expect(ctx.output.join('\n')).toContain('HTTP auth enabled; token value is not displayed.');
    expect(ctx.output.join('\n')).not.toContain('test-secret-token');
    expect(ctx.errors.join('\n')).not.toContain('test-secret-token');

    // Grab the SIGINT listener we registered and invoke it directly
    const sigintListeners = process.rawListeners('SIGINT');
    const ourListener = sigintListeners[sigintListeners.length - 1] as (() => void) | undefined;
    if (ourListener) {
      process.removeListener('SIGINT', ourListener as NodeJS.SignalsListener);
      // Also clean SIGTERM
      const sigtermListeners = process.rawListeners('SIGTERM');
      const ourTermListener = sigtermListeners[sigtermListeners.length - 1] as (() => void) | undefined;
      if (ourTermListener) {
        process.removeListener('SIGTERM', ourTermListener as NodeJS.SignalsListener);
      }
      ourListener();
    }

    const code = await servePromise;
    expect(code).toBe(0);
  });

  it('allows explicit unauthenticated localhost development mode', async () => {
    const ctx = makeCtx({ port: '0', 'allow-unauthenticated-local': true });

    const servePromise = serveCommand(ctx);

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(ctx.output.join('\n')).toContain('HTTP auth disabled for localhost development.');
    expect(ctx.output.join('\n')).toContain('Decision Core HTTP server listening on');

    const sigintListeners = process.rawListeners('SIGINT');
    const ourListener = sigintListeners[sigintListeners.length - 1] as (() => void) | undefined;
    if (ourListener) {
      process.removeListener('SIGINT', ourListener as NodeJS.SignalsListener);
      const sigtermListeners = process.rawListeners('SIGTERM');
      const ourTermListener = sigtermListeners[sigtermListeners.length - 1] as (() => void) | undefined;
      if (ourTermListener) {
        process.removeListener('SIGTERM', ourTermListener as NodeJS.SignalsListener);
      }
      ourListener();
    }

    const code = await servePromise;
    expect(code).toBe(0);
  });

  it('starts org mode without a global bearer token when agent auth store exists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dc-serve-org-'));
    cleanupFns.push(() => rmSync(root, { recursive: true, force: true }));

    const authPath = join(root, 'agent-auth.yaml');
    writeFileSync(authPath, [
      'bindings:',
      '  - subject: "not-used-by-this-test"',
      '    salt: "not-used"',
      '    agentId: "ceo-agent"',
      '    tenantId: "default"',
      '    enabled: true',
      '',
    ].join('\n'), 'utf-8');

    const ctx = makeCtx({
      port: '0',
      'agent-registry': resolve('config/agents/small-business-agents.yaml'),
      'agent-auth': authPath,
    });

    const servePromise = serveCommand(ctx);
    await new Promise(resolveTimer => setTimeout(resolveTimer, 100));

    expect(ctx.output.join('\n')).toContain('Org mode enabled: agent identity resolution active.');
    expect(ctx.output.join('\n')).toContain('Decision Core HTTP server listening on');
    expect(ctx.errors.join('\n')).not.toContain('HTTP serve requires authentication');

    const sigintListeners = process.rawListeners('SIGINT');
    const ourListener = sigintListeners[sigintListeners.length - 1] as (() => void) | undefined;
    if (ourListener) {
      process.removeListener('SIGINT', ourListener as NodeJS.SignalsListener);
      const sigtermListeners = process.rawListeners('SIGTERM');
      const ourTermListener = sigtermListeners[sigtermListeners.length - 1] as (() => void) | undefined;
      if (ourTermListener) {
        process.removeListener('SIGTERM', ourTermListener as NodeJS.SignalsListener);
      }
      ourListener();
    }

    const code = await servePromise;
    expect(code).toBe(0);
  });

  it('refuses org mode when a registry exists but auth bindings are missing', async () => {
    const ctx = makeCtx({
      port: '0',
      'agent-registry': resolve('config/agents/small-business-agents.yaml'),
      'agent-auth': resolve('does-not-exist-agent-auth.yaml'),
    });

    const code = await serveCommand(ctx);

    expect(code).toBe(1);
    expect(ctx.errors.join('\n')).toContain('no auth store was found');
  });
});
