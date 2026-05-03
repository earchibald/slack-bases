import type { SlackSession } from './types';

export interface SlackApiFormRequest {
  body: URLSearchParams;
  path: string;
  token?: string;
}

export type SlackApiFormRequester = (request: SlackApiFormRequest) => Promise<any>;

export function buildSlackAuthorizeUrl(input: {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string;
  state: string;
}): string {
  const url = new URL('https://slack.com/oauth/v2/authorize');

  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', input.state);
  url.searchParams.set('user_scope', input.scopes);

  return url.toString();
}

export async function completeSlackAuth(
  requester: SlackApiFormRequester,
  input: {
    clientId: string;
    code: string;
    codeVerifier: string;
    now?: number;
    redirectUri: string;
  }
): Promise<SlackSession> {
  const tokenResponse = await requester({
    body: new URLSearchParams({
      client_id: input.clientId,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
    }),
    path: 'oauth.v2.access',
  });
  const baseSession = mapSlackTokenResponse(tokenResponse, input.now);
  const identity = await requester({
    body: new URLSearchParams(),
    path: 'auth.test',
    token: baseSession.accessToken,
  });

  return {
    ...baseSession,
    teamId: identity.team_id ?? baseSession.teamId,
    workspace: parseWorkspaceSlug(identity.url) ?? baseSession.workspace,
  };
}

export async function createPkcePair(
  randomSource: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(32))
): Promise<{ codeChallenge: string; codeVerifier: string }> {
  const codeVerifier = toBase64Url(randomSource());
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));

  return {
    codeChallenge: toBase64Url(new Uint8Array(digest)),
    codeVerifier,
  };
}

export async function refreshSlackSession(
  requester: SlackApiFormRequester,
  input: {
    clientId: string;
    now?: number;
    session: SlackSession;
  }
): Promise<SlackSession> {
  if (!input.session.refreshToken) {
    throw new Error('Missing Slack refresh token');
  }

  const tokenResponse = await requester({
    body: new URLSearchParams({
      client_id: input.clientId,
      grant_type: 'refresh_token',
      refresh_token: input.session.refreshToken,
    }),
    path: 'oauth.v2.access',
  });
  const refreshed = mapSlackTokenResponse(tokenResponse, input.now);

  return {
    ...refreshed,
    teamId: refreshed.teamId || input.session.teamId,
    workspace: refreshed.workspace || input.session.workspace,
  };
}

function mapSlackTokenResponse(payload: any, now = Date.now()): SlackSession {
  const authedUser = payload.authed_user ?? {};

  return {
    accessToken: authedUser.access_token ?? '',
    expiresAt: authedUser.expires_in ? now + authedUser.expires_in * 1000 : 0,
    refreshToken: authedUser.refresh_token ?? '',
    teamId: payload.team?.id ?? '',
    workspace: parseWorkspaceSlug(payload.url) ?? '',
  };
}

function parseWorkspaceSlug(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).hostname.split('.')[0] ?? null;
  } catch {
    return null;
  }
}

function toBase64Url(input: Uint8Array): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
