import { describe, expect, it } from 'vitest';

import { hasValidAccessToken, shouldRefreshSession } from '../src/slack/session';

describe('hasValidAccessToken', () => {
  it('returns true when the access token has not expired yet', () => {
    expect(
      hasValidAccessToken({
        accessToken: 'xoxp-access',
        expiresAt: Date.now() + 60_000,
        teamId: 'T01',
        workspace: 'acme',
      })
    ).toBe(true);
  });
});

describe('shouldRefreshSession', () => {
  it('respects the provided leeway window', () => {
    const session = {
      accessToken: 'xoxp-access',
      expiresAt: Date.now() + 30_000,
      refreshToken: 'xoxe-refresh',
      teamId: 'T01',
      workspace: 'acme',
    };

    expect(shouldRefreshSession(session, 60_000)).toBe(true);
    expect(shouldRefreshSession(session, 20_000)).toBe(false);
  });
});
