import { pino } from 'pino';
import type { DestinationStream, Logger } from 'pino';

export type { Logger } from 'pino';

export const REDACT_PATHS = [
  'token',
  'bearerToken',
  'apiKey',
  'api_key',
  'password',
  'secret',
  'credential',
  'credentials',
  'authorization',
  'Authorization',
  'headers.authorization',
  'headers.Authorization',
  'req.headers.authorization',
  'req.headers.Authorization',
  'request.headers.authorization',
  'request.headers.Authorization',
  'config.bearerToken',
  'config.apiKey',
  'config.api_key',
  'metadata.token',
  'metadata.bearerToken',
  '*.token',
  '*.bearerToken',
  '*.apiKey',
  '*.api_key',
  '*.password',
  '*.secret',
  '*.authorization',
  '*.Authorization',
  '*.credentials',
];

export function createLogger(name: string, destination?: DestinationStream): Logger {
  const options = {
    name,
    level: process.env['LOG_LEVEL'] ?? 'info',
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
  };

  return destination ? pino(options, destination) : pino(options);
}
