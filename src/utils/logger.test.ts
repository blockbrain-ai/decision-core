import { describe, it, expect } from 'vitest';
import { createLogger } from './logger.js';
import { PassThrough } from 'node:stream';

async function captureLog(fn: (logger: ReturnType<typeof createLogger>) => void): Promise<string> {
  const chunks: Buffer[] = [];
  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));

  const previousLogLevel = process.env['LOG_LEVEL'];
  process.env['LOG_LEVEL'] = 'info';

  try {
    const logger = createLogger('test', stream);
    fn(logger);
    (logger as { flush?: () => void }).flush?.();
    await new Promise((resolve) => setImmediate(resolve));

    return Buffer.concat(chunks).toString('utf-8');
  } finally {
    if (previousLogLevel === undefined) {
      delete process.env['LOG_LEVEL'];
    } else {
      process.env['LOG_LEVEL'] = previousLogLevel;
    }
  }
}

describe('createLogger', () => {
  it('returns a pino logger with redaction configured', () => {
    const logger = createLogger('test-logger');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('redacts top-level token field', async () => {
    const output = await captureLog((logger) => {
      logger.info({ token: 'test-secret-token' }, 'auth check');
    });
    expect(output).not.toContain('test-secret-token');
    expect(output).toContain('[REDACTED]');
  });

  it('redacts nested authorization header', async () => {
    const output = await captureLog((logger) => {
      logger.info({ headers: { authorization: 'Bearer super-secret-value' } }, 'request');
    });
    expect(output).not.toContain('super-secret-value');
    expect(output).toContain('[REDACTED]');
  });

  it('redacts password field', async () => {
    const output = await captureLog((logger) => {
      logger.info({ password: 'hunter2' }, 'login attempt');
    });
    expect(output).not.toContain('hunter2');
    expect(output).toContain('[REDACTED]');
  });

  it('redacts apiKey field', async () => {
    const output = await captureLog((logger) => {
      logger.info({ apiKey: 'sk-live-abc123' }, 'provider call');
    });
    expect(output).not.toContain('sk-live-abc123');
    expect(output).toContain('[REDACTED]');
  });

  it('passes through non-secret fields unmodified', async () => {
    const output = await captureLog((logger) => {
      logger.info({ host: '127.0.0.1', port: 3000 }, 'server started');
    });
    expect(output).toContain('127.0.0.1');
    expect(output).toContain('3000');
    expect(output).not.toContain('[REDACTED]');
  });

  it('redacts config.bearerToken in nested objects', async () => {
    const output = await captureLog((logger) => {
      logger.info({ config: { bearerToken: 'nested-secret-value' } }, 'config loaded');
    });
    expect(output).not.toContain('nested-secret-value');
    expect(output).toContain('[REDACTED]');
  });
});
