import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAgent } from '../src/detect.js';

const AGENT_VARS = [
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

describe('isAgent', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of AGENT_VARS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of AGENT_VARS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('returns false when no agent env vars are set', () => {
    // /opt/.devin is unlikely to exist on the test machine
    expect(isAgent()).toBe(false);
  });

  for (const key of AGENT_VARS) {
    it(`returns true when ${key} is set`, () => {
      process.env[key] = '1';
      expect(isAgent()).toBe(true);
    });
  }

  it('ignores empty string values', () => {
    process.env.CLAUDECODE = '';
    expect(isAgent()).toBe(false);
  });
});
