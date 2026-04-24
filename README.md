# agent-output-optimizer

> Agent-optimized output for Vite. Detects AI coding agents and replaces verbose build output with compact, structured JSON.

Inspired by [PAO](https://github.com/nunomaduro/pao) for PHP.

---

## Why

When an AI agent (Claude Code, Cursor, Devin, Gemini CLI, etc.) runs `vite build` or `vite dev`, the agent's context window gets flooded with hundreds of lines of ASCII tables, ANSI color codes, chunk reports, and stack traces it has to parse anyway.

**agent-output-optimizer** detects these environments automatically and swaps the output for a single-line JSON that the agent can parse in one step — freeing tokens and improving fix accuracy.

When a human runs the same command, the output is completely unchanged.

## Install

```bash
npm install -D agent-output-optimizer
# or
pnpm add -D agent-output-optimizer
```

Requires **Vite 5, 6, 7, or 8**.

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import optimizer from 'agent-output-optimizer';

export default defineConfig({
  plugins: [
    optimizer(),
    // ...your other plugins
  ],
});
```

That's it. No config needed. The plugin activates only when an AI agent is detected.

## What you get

### Build — successful

```json
{"mode":"build","result":"passed","duration_ms":2120}
```

### Build — failed

```json
{
  "mode": "build",
  "result": "failed",
  "duration_ms": 1972,
  "errors": [
    {
      "message": "Could not load ../../../resources/js/routess",
      "code": "UNLOADABLE_DEPENDENCY",
      "file": "resources/js/pages/dashboard.tsx",
      "line": 4,
      "column": 27
    }
  ]
}
```

### Dev server

```json
{"mode":"dev","ready":true,"url":"http://localhost:5173","port":5173,"duration_ms":6}
```

### HMR (opt-in)

```json
{"mode":"hmr","file":"resources/js/pages/dashboard.tsx","modules":1}
```

## Options

```ts
optimizer({
  force: false,    // force-enable even if no agent detected
  disable: false,  // force-disable even if agent detected
  chunks: false,   // include per-chunk size/gzip info in build output
  gzip: true,      // compute gzip sizes when chunks is true
  hmr: false,      // emit a JSON line per HMR update
});
```

### `chunks: true` — bundle-size auditing

```json
{
  "mode": "build",
  "result": "passed",
  "duration_ms": 2254,
  "chunks": [
    { "file": "assets/app-BatQDfhm.js", "size": 230317, "gzip": 65235 },
    { "file": "assets/app-BwJKfC5G.css", "size": 91182, "gzip": 15164 }
  ]
}
```

## Detected agents

Auto-detects via environment variables and filesystem markers:

| Agent | Detection |
|---|---|
| Claude Code | `CLAUDECODE`, `CLAUDE_CODE` |
| Cursor | `CURSOR_AGENT`, `CURSOR_TRACE_ID`, `CURSOR_EXTENSION_HOST_ROLE` |
| Gemini CLI | `GEMINI_CLI` |
| Codex CLI | `CODEX_SANDBOX`, `CODEX_CI`, `CODEX_THREAD_ID` |
| GitHub Copilot | `COPILOT_CLI`, `COPILOT_MODEL`, `COPILOT_ALLOW_ALL`, `COPILOT_GITHUB_TOKEN` |
| Antigravity | `ANTIGRAVITY_AGENT` |
| Augment CLI | `AUGMENT_AGENT` |
| OpenCode | `OPENCODE_CLIENT`, `OPENCODE` |
| Amp | `AMP_CURRENT_THREAD_ID` |
| Pi | `PI_CODING_AGENT` |
| Kiro CLI | `KIRO_AGENT_PATH` |
| Replit | `REPL_ID` |
| Devin | `/opt/.devin` file |
| Generic | `AI_AGENT` |

## What it does

- **Silences** Vite's default CLI output (banner, progress, chunk tables, stack traces).
- **Strips** ANSI escape codes and box-drawing characters from error messages.
- **Extracts** structured error info (file, line, column, plugin, error code) from both `rollup`/`rolldown` error objects and formatted frames.
- **Intercepts** `process.stderr.write` so Vite's CLI-level error prints don't leak after the JSON.
- **Emits exactly one JSON line** per build on `stdout`, regardless of project size.

## License

MIT
