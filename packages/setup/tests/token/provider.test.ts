import { describe, expect, it, beforeEach } from 'vitest';
import { resolveToken } from '../../src/token/provider.js';

describe('resolveToken', () => {
  beforeEach(() => {
    delete process.env.SLACK_CONFIG_TOKEN;
  });

  it('returns the flag value when provided', () => {
    const token = resolveToken({ token: 'xoxe-flag', env: process.env, readFile: () => '' });
    expect(token).toBe('xoxe-flag');
  });

  it('falls back to env var when no flag is provided', () => {
    const env = { SLACK_CONFIG_TOKEN: 'xoxe-env' };
    const token = resolveToken({ token: null, env, readFile: () => '' });
    expect(token).toBe('xoxe-env');
  });

  it('falls back to file when no flag or env var', () => {
    const token = resolveToken({ token: null, env: {}, readFile: () => 'xoxe-file' });
    expect(token).toBe('xoxe-file');
  });

  it('returns null when no source provides a token', () => {
    const token = resolveToken({ token: null, env: {}, readFile: () => '' });
    expect(token).toBeNull();
  });

  it('flag beats env var beats file', () => {
    const env = { SLACK_CONFIG_TOKEN: 'xoxe-env' };
    const token = resolveToken({ token: 'xoxe-flag', env, readFile: () => 'xoxe-file' });
    expect(token).toBe('xoxe-flag');
  });
});
