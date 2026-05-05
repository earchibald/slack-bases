import { describe, expect, it } from 'vitest';
import { slackErrorToMessage, isRetryableError } from '../../src/errors/mapping.js';

describe('slackErrorToMessage', () => {
  it('returns a message for known errors', () => {
    expect(slackErrorToMessage('invalid_auth')).toContain('Token rejected');
    expect(slackErrorToMessage('not_authed')).toContain('No valid token');
    expect(slackErrorToMessage('rate_limited')).toContain('Rate limited');
  });

  it('returns null for unknown errors', () => {
    expect(slackErrorToMessage('unknown_error')).toBeNull();
  });
});

describe('isRetryableError', () => {
  it('returns true for retryable errors', () => {
    expect(isRetryableError('rate_limited')).toBe(true);
    expect(isRetryableError('fatal_error')).toBe(true);
  });

  it('returns false for non-retryable errors', () => {
    expect(isRetryableError('invalid_auth')).toBe(false);
    expect(isRetryableError('not_found')).toBe(false);
  });
});
