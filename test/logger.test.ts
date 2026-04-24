import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSilentLogger, emit } from '../src/logger.js';

describe('createSilentLogger', () => {
  it('creates a logger whose methods are no-ops', () => {
    const logger = createSilentLogger();
    expect(logger.hasWarned).toBe(false);
    expect(logger.hasErrorLogged()).toBe(false);
    expect(() => logger.info('x')).not.toThrow();
    expect(() => logger.warn('x')).not.toThrow();
    expect(() => logger.warnOnce('x')).not.toThrow();
    expect(() => logger.error('x')).not.toThrow();
    expect(() => logger.clearScreen('error')).not.toThrow();
  });
});

describe('emit', () => {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);

  afterEach(() => {
    writes.length = 0;
  });

  it('writes a single JSON line with trailing newline', () => {
    emit({ mode: 'build', result: 'passed' });
    expect(writes).toHaveLength(1);
    expect(writes[0].endsWith('\n')).toBe(true);
    expect(JSON.parse(writes[0])).toEqual({ mode: 'build', result: 'passed' });
  });

  it('preserves key order provided by the caller', () => {
    emit({ mode: 'dev', ready: true, port: 5173 });
    expect(writes[0]).toBe('{"mode":"dev","ready":true,"port":5173}\n');
  });
});
