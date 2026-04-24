import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import optimizer from '../src/index.js';

type Emitted = Record<string, unknown>;

function captureStdout(): { emitted: Emitted[]; restore: () => void } {
  const emitted: Emitted[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    const s = String(chunk).trim();
    if (s) {
      try { emitted.push(JSON.parse(s)); } catch { /* ignore non-JSON */ }
    }
    return true;
  }) as typeof process.stdout.write);
  return { emitted, restore: () => spy.mockRestore() };
}

function callHook<T = unknown>(plugin: any, name: string, ...args: unknown[]): T {
  const hook = plugin[name];
  const fn = typeof hook === 'function' ? hook : hook?.handler;
  return fn.call(plugin, ...args);
}

// Strip env vars that might make isAgent() report true during tests
const AGENT_VARS = [
  'AI_AGENT', 'CLAUDECODE', 'CLAUDE_CODE', 'CURSOR_AGENT', 'CURSOR_TRACE_ID',
  'CURSOR_EXTENSION_HOST_ROLE', 'GEMINI_CLI', 'CODEX_SANDBOX', 'CODEX_CI',
  'CODEX_THREAD_ID', 'ANTIGRAVITY_AGENT', 'AUGMENT_AGENT', 'OPENCODE_CLIENT',
  'OPENCODE', 'AMP_CURRENT_THREAD_ID', 'PI_CODING_AGENT', 'KIRO_AGENT_PATH',
  'REPL_ID', 'COPILOT_CLI', 'COPILOT_MODEL', 'COPILOT_ALLOW_ALL', 'COPILOT_GITHUB_TOKEN',
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of AGENT_VARS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of AGENT_VARS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('plugin activation', () => {
  it('exposes plugin metadata', () => {
    const p = optimizer();
    expect(p.name).toBe('agent-output-optimizer');
    expect(p.enforce).toBe('pre');
  });

  it('is inactive by default without agent env', () => {
    const p = optimizer();
    const result = callHook(p, 'config', {});
    expect(result).toBeUndefined();
  });

  it('force: true activates even without agent', () => {
    const p = optimizer({ force: true });
    const result = callHook<any>(p, 'config', {});
    expect(result).toBeDefined();
    expect(result.logLevel).toBe('silent');
    expect(result.build.reportCompressedSize).toBe(false);
    expect(result.customLogger).toBeDefined();
  });

  it('disable: true deactivates even when agent detected', () => {
    process.env.CLAUDECODE = '1';
    const p = optimizer({ disable: true });
    expect(callHook(p, 'config', {})).toBeUndefined();
  });
});

describe('build mode', () => {
  const resolved = { command: 'build', server: {} } as any;

  it('emits passed result with duration on successful build', async () => {
    const { emitted, restore } = captureStdout();
    const p = optimizer({ force: true });
    callHook(p, 'configResolved', resolved);
    callHook(p, 'buildStart');
    await new Promise((r) => setTimeout(r, 5));
    callHook(p, 'buildEnd');
    callHook(p, 'closeBundle');
    restore();

    expect(emitted).toHaveLength(1);
    expect(emitted[0].mode).toBe('build');
    expect(emitted[0].result).toBe('passed');
    expect(typeof emitted[0].duration_ms).toBe('number');
    expect(emitted[0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('emits failed result with normalized error', () => {
    const { emitted, restore } = captureStdout();
    const p = optimizer({ force: true });
    callHook(p, 'configResolved', resolved);
    callHook(p, 'buildStart');
    const err = Object.assign(new Error('Could not load ../../../resources/js/routess'), {
      code: 'UNLOADABLE_DEPENDENCY',
      loc: { file: 'resources/js/pages/dashboard.tsx', line: 4, column: 27 },
    });
    callHook(p, 'buildEnd', err);
    callHook(p, 'closeBundle');
    restore();

    expect(emitted).toHaveLength(1);
    expect(emitted[0].mode).toBe('build');
    expect(emitted[0].result).toBe('failed');
    const errors = emitted[0].errors as any[];
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      message: 'Could not load ../../../resources/js/routess',
      code: 'UNLOADABLE_DEPENDENCY',
      file: 'resources/js/pages/dashboard.tsx',
      line: 4,
      column: 27,
    });
  });

  it('emits only once even if closeBundle is called twice', () => {
    const { emitted, restore } = captureStdout();
    const p = optimizer({ force: true });
    callHook(p, 'configResolved', resolved);
    callHook(p, 'buildStart');
    callHook(p, 'closeBundle');
    callHook(p, 'closeBundle');
    restore();
    expect(emitted).toHaveLength(1);
  });

  it('does not emit when plugin is inactive', () => {
    const { emitted, restore } = captureStdout();
    const p = optimizer(); // not active
    callHook(p, 'configResolved', resolved);
    callHook(p, 'buildStart');
    callHook(p, 'closeBundle');
    restore();
    expect(emitted).toHaveLength(0);
  });

  it('does not emit build output in dev (serve) mode', () => {
    const { emitted, restore } = captureStdout();
    const p = optimizer({ force: true });
    callHook(p, 'configResolved', { command: 'serve', server: {} } as any);
    callHook(p, 'buildStart');
    callHook(p, 'closeBundle');
    restore();
    expect(emitted).toHaveLength(0);
  });
});

describe('chunks option', () => {
  const resolved = { command: 'build', server: {} } as any;

  it('collects chunk and asset sizes with gzip by default when chunks: true', () => {
    const { emitted, restore } = captureStdout();
    const p = optimizer({ force: true, chunks: true });
    callHook(p, 'configResolved', resolved);
    callHook(p, 'buildStart');
    callHook(p, 'generateBundle', {}, {
      'app.js': { type: 'chunk', code: 'console.log("hello world")'.repeat(50) },
      'app.css': { type: 'asset', source: 'body{color:red}'.repeat(20) },
      'empty.txt': { type: 'asset', source: '' },
    });
    callHook(p, 'closeBundle');
    restore();

    const chunks = emitted[0].chunks as any[];
    expect(chunks).toHaveLength(3);

    const js = chunks.find((c) => c.file === 'app.js');
    expect(js.size).toBeGreaterThan(0);
    expect(typeof js.gzip).toBe('number');

    const css = chunks.find((c) => c.file === 'app.css');
    expect(css.size).toBeGreaterThan(0);
    expect(typeof css.gzip).toBe('number');

    const empty = chunks.find((c) => c.file === 'empty.txt');
    expect(empty.size).toBe(0);
    expect(empty.gzip).toBeUndefined(); // skipped for empty assets
  });

  it('skips gzip when gzip: false', () => {
    const { emitted, restore } = captureStdout();
    const p = optimizer({ force: true, chunks: true, gzip: false });
    callHook(p, 'configResolved', { command: 'build', server: {} } as any);
    callHook(p, 'buildStart');
    callHook(p, 'generateBundle', {}, {
      'app.js': { type: 'chunk', code: 'x'.repeat(100) },
    });
    callHook(p, 'closeBundle');
    restore();

    const chunks = emitted[0].chunks as any[];
    expect(chunks[0].size).toBe(100);
    expect(chunks[0].gzip).toBeUndefined();
  });

  it('produces valid gzip payloads', () => {
    const { emitted, restore } = captureStdout();
    const p = optimizer({ force: true, chunks: true });
    callHook(p, 'configResolved', { command: 'build', server: {} } as any);
    callHook(p, 'buildStart');
    const code = 'export const x = 1;\n'.repeat(200);
    callHook(p, 'generateBundle', {}, { 'x.js': { type: 'chunk', code } });
    callHook(p, 'closeBundle');
    restore();

    const chunks = emitted[0].chunks as any[];
    expect(chunks[0].gzip).toBeLessThan(chunks[0].size); // repetitive text should compress
    // sanity: gzip should be an int count of bytes
    expect(Number.isInteger(chunks[0].gzip)).toBe(true);
  });

  it('omits chunks from output when option is off', () => {
    const { emitted, restore } = captureStdout();
    const p = optimizer({ force: true });
    callHook(p, 'configResolved', { command: 'build', server: {} } as any);
    callHook(p, 'buildStart');
    callHook(p, 'generateBundle', {}, { 'app.js': { type: 'chunk', code: 'x' } });
    callHook(p, 'closeBundle');
    restore();
    expect(emitted[0].chunks).toBeUndefined();
  });
});

describe('HMR', () => {
  it('does not emit HMR events by default', () => {
    const { emitted, restore } = captureStdout();
    const p = optimizer({ force: true });
    callHook(p, 'handleHotUpdate', { file: 'src/a.tsx', modules: [{}, {}] });
    restore();
    expect(emitted).toHaveLength(0);
  });

  it('emits HMR event when hmr: true', () => {
    const { emitted, restore } = captureStdout();
    const p = optimizer({ force: true, hmr: true });
    callHook(p, 'handleHotUpdate', { file: 'src/a.tsx', modules: [{}, {}] });
    restore();
    expect(emitted[0]).toEqual({ mode: 'hmr', file: 'src/a.tsx', modules: 2 });
  });

  it('does not emit HMR when plugin inactive', () => {
    const { emitted, restore } = captureStdout();
    const p = optimizer({ hmr: true });
    callHook(p, 'handleHotUpdate', { file: 'src/a.tsx', modules: [] });
    restore();
    expect(emitted).toHaveLength(0);
  });
});

describe('error normalization', () => {
  const resolved = { command: 'build', server: {} } as any;

  function runWithErr(err: unknown) {
    const { emitted, restore } = captureStdout();
    const p = optimizer({ force: true });
    callHook(p, 'configResolved', resolved);
    callHook(p, 'buildStart');
    callHook(p, 'buildEnd', err);
    callHook(p, 'closeBundle');
    restore();
    return (emitted[0].errors as any[])[0];
  }

  it('strips ANSI escape codes from the message', () => {
    const raw = '\x1b[31mSomething failed\x1b[0m at src/a.ts:1:1';
    const e = runWithErr(new Error(raw));
    expect(e.message).not.toMatch(/\x1b\[/);
    expect(e.message).toContain('Something failed');
  });

  it('extracts [CODE] tag when code is not on the error object', () => {
    const err = new Error('[SOME_CODE] bad thing happened in src/foo.ts:10:5');
    const e = runWithErr(err);
    expect(e.code).toBe('SOME_CODE');
  });

  it('extracts plugin name from [plugin name] tag in body', () => {
    const err = new Error('[plugin vite:resolve]\nfailed to resolve');
    const e = runWithErr(err);
    expect(e.plugin).toBe('vite:resolve');
  });

  it('prefers explicit plugin field over body tag', () => {
    const err = Object.assign(new Error('[plugin other]\nboom'), { plugin: 'primary' });
    const e = runWithErr(err);
    expect(e.plugin).toBe('primary');
  });

  it('extracts user file/line/column from body when loc is missing', () => {
    const err = new Error('parse error in src/pages/index.tsx:42:13');
    const e = runWithErr(err);
    expect(e.file).toBe('src/pages/index.tsx');
    expect(e.line).toBe(42);
    expect(e.column).toBe(13);
  });

  it('ignores node_modules paths in extracted files', () => {
    const err = new Error('thing at node_modules/foo/index.js:1:1');
    const e = runWithErr(err);
    expect(e.file).toBeUndefined();
  });

  it('uses loc over body-extracted file', () => {
    const err = Object.assign(
      new Error('mention of src/other.ts:1:1 in body'),
      { loc: { file: 'src/real.ts', line: 99, column: 3 } },
    );
    const e = runWithErr(err);
    expect(e.file).toBe('src/real.ts');
    expect(e.line).toBe(99);
    expect(e.column).toBe(3);
  });

  it('skips stack-trace lines when extracting files', () => {
    const err = new Error(
      'Build broke\n    at Foo (src/internal.ts:1:1)\nreal cause in src/user.tsx:10:2',
    );
    const e = runWithErr(err);
    expect(e.file).toBe('src/user.tsx');
    expect(e.line).toBe(10);
  });

  it('handles non-Error values', () => {
    const e = runWithErr('a string failure');
    expect(e.message).toBe('a string failure');
  });

  it('strips RolldownError:/Error: prefixes and duplicate [CODE] prefix from message body', () => {
    const err = new Error('RolldownError: [SOME_CODE] actual message');
    const e = runWithErr(err);
    expect(e.message).toBe('actual message');
    expect(e.code).toBe('SOME_CODE');
  });
});
