/**
 * Minimal structured logger for the workers package.
 *
 * Emits one JSON object per line so log aggregators can parse fields.
 * Deliberately dependency-free (no pino in this package's dependencies).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Logger = (
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
) => void;

/** Create a logger bound to a component name (worker name, relay, ...). */
export function createLogger(component: string): Logger {
  return (level, message, fields = {}) => {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        component,
        level,
        message,
        ...fields,
      }),
    );
  };
}

/** Safely extract a message from an unknown thrown value for log fields. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
