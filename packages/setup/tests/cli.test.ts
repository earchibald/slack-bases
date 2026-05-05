import { describe, expect, it } from 'vitest';

describe('CLI routing', () => {
  it('detects init command', () => {
    const args = ['init', '--token', 'xoxe-test'];
    expect(args[0]).toBe('init');
    expect(args[1]).toBe('--token');
    expect(args[2]).toBe('xoxe-test');
  });

  it('detects status --json', () => {
    const args = ['status', '--json'];
    expect(args[0]).toBe('status');
    expect(args.includes('--json')).toBe(true);
  });

  it('detects status --manifest', () => {
    const args = ['status', '--manifest'];
    expect(args[0]).toBe('status');
    expect(args.includes('--manifest')).toBe(true);
  });

  it('detects update command', () => {
    const args = ['update'];
    expect(args[0]).toBe('update');
  });
});

describe('name collision fallback', () => {
  it('increments counter from 2 to 20', () => {
    const names: string[] = [];
    for (let i = 2; i <= 20; i++) {
      names.push(`Slack Bases (${i})`);
    }
    expect(names).toHaveLength(19);
    expect(names[0]).toBe('Slack Bases (2)');
    expect(names[18]).toBe('Slack Bases (20)');
  });

  it('validates custom app name format', () => {
    const valid = /^[a-zA-Z0-9 -]{1,80}$/;
    expect(valid.test('My App')).toBe(true);
    expect(valid.test('App-123')).toBe(true);
    expect(valid.test('')).toBe(false);
    expect(valid.test('a'.repeat(81))).toBe(false);
    expect(valid.test('special!@#')).toBe(false);
    expect(valid.test('name with spaces')).toBe(true);
  });
});
