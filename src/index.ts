import { gzipSync } from 'node:zlib';
import type { Plugin, ResolvedConfig } from 'vite';
import { isAgent } from './detect.js';
import { createSilentLogger, emit } from './logger.js';

export interface OptimizerOptions {
  force?: boolean;
  disable?: boolean;
  hmr?: boolean;
  chunks?: boolean;
  gzip?: boolean;
}

interface ChunkInfo {
  file: string;
  size: number;
  gzip?: number;
}

interface BuildError {
  message: string;
  code?: string;
  plugin?: string;
  file?: string;
  line?: number;
  column?: number;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const BOX_RE = /[─-▟]/g;

function clean(s: string): string {
  return s
    .replace(ANSI_RE, '')
    .replace(BOX_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function optimizer(options: OptimizerOptions = {}): Plugin {
  const active = options.force || (!options.disable && isAgent());
  const emitHmr = options.hmr ?? false;
  const emitChunks = options.chunks ?? false;
  const computeGzip = options.gzip ?? true;

  let config: ResolvedConfig;
  let startedAt = 0;
  let emitted = false;
  let stderrPatched = false;
  const chunks: ChunkInfo[] = [];
  const errors: BuildError[] = [];

  function silenceStderr() {
    if (stderrPatched) return;
    process.stderr.write = ((_chunk: unknown, _enc?: unknown, cb?: unknown) => {
      if (typeof cb === 'function') (cb as () => void)();
      return true;
    }) as typeof process.stderr.write;
    stderrPatched = true;
  }

  return {
    name: 'agent-output-optimizer',
    enforce: 'pre',
    apply: () => true,

    config(userConfig) {
      if (!active) return;
      silenceStderr();
      return {
        logLevel: 'silent',
        customLogger: createSilentLogger(),
        build: {
          ...userConfig.build,
          reportCompressedSize: false,
        },
      };
    },

    configResolved(resolved) {
      config = resolved;
    },

    configureServer(server) {
      if (!active) return;

      const httpServer = server.httpServer;
      if (!httpServer) return;

      const origListen = httpServer.listen.bind(httpServer);
      const devStart = Date.now();

      httpServer.on('listening', () => {
        const addr = httpServer.address();
        const port = typeof addr === 'object' && addr ? addr.port : null;
        const host = config.server.host === true ? '0.0.0.0' : (config.server.host as string | undefined) ?? 'localhost';
        emit({
          mode: 'dev',
          ready: true,
          url: `http://${host}:${port}`,
          port,
          duration_ms: Date.now() - devStart,
        });
      });

      return origListen;
    },

    handleHotUpdate(ctx) {
      if (!active || !emitHmr) return;
      emit({ mode: 'hmr', file: ctx.file, modules: ctx.modules.length });
    },

    buildStart() {
      if (!active) return;
      startedAt = Date.now();
      chunks.length = 0;
      errors.length = 0;
    },

    generateBundle(_opts, bundle) {
      if (!active || !emitChunks) return;
      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type === 'chunk') {
          const size = Buffer.byteLength(item.code);
          const chunk: ChunkInfo = { file: fileName, size };
          if (computeGzip) chunk.gzip = gzipSync(item.code).length;
          chunks.push(chunk);
        } else if (item.type === 'asset') {
          const source = typeof item.source === 'string' ? Buffer.from(item.source) : Buffer.from(item.source);
          const size = source.byteLength;
          const chunk: ChunkInfo = { file: fileName, size };
          if (computeGzip && size > 0) chunk.gzip = gzipSync(source).length;
          chunks.push(chunk);
        }
      }
    },

    buildEnd(err) {
      if (!active || !err) return;
      errors.push(normalizeError(err));
    },

    closeBundle() {
      if (!active || config.command !== 'build' || emitted) return;
      emitted = true;
      emit({
        mode: 'build',
        result: errors.length ? 'failed' : 'passed',
        duration_ms: Date.now() - startedAt,
        ...(emitChunks ? { chunks } : {}),
        ...(errors.length ? { errors } : {}),
      });
    },
  };
}

const STACK_LINE_RE = /^\s*at\s+.+\(.+\)\s*$|^\s*at\s+\S+:\d+:\d+\s*$/;
const PLUGIN_TAG_RE = /^\[plugin\s+(.+?)\]$/;
const NOISE_RE = /^(Build failed with \d+ error|errors:\s*\[Getter\/Setter\]|\{|\})\s*:?\s*$/i;

function normalizeError(err: unknown): BuildError {
  if (err instanceof Error) {
    const e = err as Error & {
      code?: string;
      plugin?: string;
      loc?: { file?: string; line?: number; column?: number };
      id?: string;
    };

    const cleaned = clean(e.message);
    const bodyLines: string[] = [];
    let pluginFromBody: string | undefined;

    for (const raw of cleaned.split('\n')) {
      const t = raw.trim();
      if (!t) continue;
      if (STACK_LINE_RE.test(raw)) continue;
      if (NOISE_RE.test(t)) continue;

      const p = t.match(PLUGIN_TAG_RE);
      if (p) {
        pluginFromBody = p[1];
        continue;
      }
      bodyLines.push(
        t.replace(/^RolldownError:\s*/, '')
         .replace(/^Error:\s*/, '')
         .replace(/^\[[A-Z][A-Z0-9_]+\]\s*/, ''),
      );
    }

    const message = bodyLines.join(' — ') || cleaned.split('\n')[0] || 'Unknown error';

    const out: BuildError = { message };

    let code = e.code;
    if (!code) {
      const m = cleaned.match(/\[([A-Z][A-Z0-9_]+)\]/);
      if (m) code = m[1];
    }
    if (code) out.code = code;

    const plugin = e.plugin ?? pluginFromBody;
    if (plugin) out.plugin = plugin;

    let file = e.loc?.file ?? e.id;
    let line = e.loc?.line;
    let column = e.loc?.column;

    if (!file || line === undefined) {
      const userFile = findUserFile(cleaned);
      if (userFile) {
        file = file ?? userFile.file;
        line = line ?? userFile.line;
        column = column ?? userFile.column;
      }
    }

    if (file && !file.includes('node_modules/') && !file.startsWith('file:///')) {
      out.file = file;
      if (line !== undefined) out.line = line;
      if (column !== undefined) out.column = column;
    }

    return out;
  }
  return { message: clean(String(err)) };
}

function findUserFile(cleaned: string): { file: string; line: number; column: number } | null {
  const re = /([^\s\[\]()"']+\.(?:tsx?|jsx?|mjs|cjs|vue|svelte|css|scss|sass)):(\d+):(\d+)/g;
  for (const line of cleaned.split('\n')) {
    if (STACK_LINE_RE.test(line)) continue;
    re.lastIndex = 0;
    const m = re.exec(line);
    if (!m) continue;
    if (m[1].includes('node_modules/') || m[1].startsWith('file://')) continue;
    return { file: m[1], line: Number(m[2]), column: Number(m[3]) };
  }
  return null;
}

export { optimizer };
