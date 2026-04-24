import type { Logger } from 'vite';

export function createSilentLogger(): Logger {
  const noop = () => {};
  return {
    hasWarned: false,
    info: noop,
    warn: noop,
    warnOnce: noop,
    error: noop,
    clearScreen: noop,
    hasErrorLogged: () => false,
  };
}

export function emit(payload: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(payload) + '\n');
}
