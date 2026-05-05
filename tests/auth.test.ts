import { describe, expect, it } from 'vitest';

import {
  buildSlackAuthorizeUrl,
  completeSlackAuth,
  createPkcePair,
  refreshSlackSession,
} from '../src/slack/auth';

describe('buildSlackAuthorizeUrl', () => {
  it('builds a Slack OAuth URL with PKCE and user scopes', () => {
    const url = new URL(
      buildSlackAuthorizeUrl({
        clientId: '123.456',
        codeChallenge: 'challenge',
        redirectUri: 'obsidian://slack-bases-auth',
        scopes: 'channels:read,users:read',
        state: 'state-token',
      })
    );

    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('client_id')).toBe('123.456');
    expect(url.searchParams.get('code_challenge')).toBe('challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('obsidian://slack-bases-auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-token');
    expect(url.searchParams.get('user_scope')).toBe('channels:read,users:read');
    expect(url.searchParams.get('team')).toBeNull();
  });

  it('includes the team param when teamId is provided', () => {
    const url = new URL(
      buildSlackAuthorizeUrl({
        clientId: '123.456',
        codeChallenge: 'challenge',
        redirectUri: 'obsidian://slack-bases-auth',
        scopes: 'channels:read,users:read',
        state: 'state-token',
        teamId: 'T01234567',
      })
    );

    expect(url.searchParams.get('team')).toBe('T01234567');
  });
});

describe('completeSlackAuth', () => {
  it('exchanges the callback code for a session with expiry metadata and workspace identity', async () => {
    const now = 1_714_490_435_000;
    const session = await completeSlackAuth(
      async (request) => {
        if (request.path === 'oauth.v2.access') {
          expect(request.body.get('code')).toBe('code-123');
          expect(request.body.get('code_verifier')).toBe('verifier-123');

          return {
            authed_user: {
              access_token: 'xoxp-access',
              expires_in: 3600,
              refresh_token: 'xoxe-refresh',
            },
            ok: true,
            team: {
              id: 'T01',
            },
          };
        }

        expect(request.path).toBe('auth.test');
        expect(request.token).toBe('xoxp-access');

        return {
          ok: true,
          team: 'Acme',
          team_id: 'T01',
          url: 'https://acme.slack.com/',
        };
      },
      {
        clientId: '123.456',
        code: 'code-123',
        codeVerifier: 'verifier-123',
        now,
        redirectUri: 'obsidian://slack-bases-auth',
      }
    );

    expect(session).toEqual({
      accessToken: 'xoxp-access',
      expiresAt: now + 3_600_000,
      refreshToken: 'xoxe-refresh',
      teamId: 'T01',
      workspace: 'acme',
    });
  });
});

describe('refreshSlackSession', () => {
  it('refreshes an expiring user token while keeping the workspace identity', async () => {
    const now = 1_714_490_435_000;
    const session = await refreshSlackSession(
      async (request) => {
        expect(request.path).toBe('oauth.v2.access');
        expect(request.body.get('grant_type')).toBe('refresh_token');
        expect(request.body.get('refresh_token')).toBe('xoxe-refresh');

        return {
          authed_user: {
            access_token: 'xoxp-next',
            expires_in: 7200,
            refresh_token: 'xoxe-next',
          },
          ok: true,
          team: {
            id: 'T01',
          },
        };
      },
      {
        clientId: '123.456',
        now,
        session: {
          accessToken: 'xoxp-old',
          expiresAt: now + 1_000,
          refreshToken: 'xoxe-refresh',
          teamId: 'T01',
          workspace: 'acme',
        },
      }
    );

    expect(session).toEqual({
      accessToken: 'xoxp-next',
      expiresAt: now + 7_200_000,
      refreshToken: 'xoxe-next',
      teamId: 'T01',
      workspace: 'acme',
    });
  });
});

describe('createPkcePair', () => {
  it('creates a verifier and URL-safe challenge', async () => {
    const pair = await createPkcePair(() => new Uint8Array([1, 2, 3, 4]));

    expect(pair.codeVerifier.length).toBeGreaterThan(0);
    expect(pair.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
