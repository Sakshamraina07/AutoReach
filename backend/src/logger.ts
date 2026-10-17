import { pino, type Logger } from 'pino';

/**
 * Structured JSON logging. Anything that could contain credentials or email
 * content is redacted; email bodies are never logged by application code.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
  '*.access_token',
  '*.refresh_token',
  '*.id_token',
  '*.code_verifier',
  '*.token',
  '*.password',
  '*.body_text',
  '*.raw',
  '*.apiKey',
  '*.api_key',
];

export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'autoreach-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' } } }
      : {}),
  });
}

export type { Logger };
