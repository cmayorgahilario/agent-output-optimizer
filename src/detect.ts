import { existsSync } from 'node:fs';

const AGENT_ENV_VARS = [
  'AI_AGENT',
  'CLAUDECODE',
  'CLAUDE_CODE',
  'CURSOR_AGENT',
  'CURSOR_TRACE_ID',
  'CURSOR_EXTENSION_HOST_ROLE',
  'GEMINI_CLI',
  'CODEX_SANDBOX',
  'CODEX_CI',
  'CODEX_THREAD_ID',
  'ANTIGRAVITY_AGENT',
  'AUGMENT_AGENT',
  'OPENCODE_CLIENT',
  'OPENCODE',
  'AMP_CURRENT_THREAD_ID',
  'PI_CODING_AGENT',
  'KIRO_AGENT_PATH',
  'REPL_ID',
  'COPILOT_CLI',
  'COPILOT_MODEL',
  'COPILOT_ALLOW_ALL',
  'COPILOT_GITHUB_TOKEN',
];

export function isAgent(): boolean {
  for (const key of AGENT_ENV_VARS) {
    if (process.env[key]) return true;
  }

  if (existsSync('/opt/.devin')) return true;

  return false;
}
