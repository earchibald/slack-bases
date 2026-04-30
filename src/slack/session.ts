import type { SlackSession } from './types';

export function hasValidAccessToken(session: SlackSession): boolean {
  return Boolean(session.accessToken && (!session.expiresAt || session.expiresAt > Date.now()));
}

export function shouldRefreshSession(session: SlackSession): boolean {
  return Boolean(
    session.accessToken &&
      session.refreshToken &&
      session.expiresAt &&
      session.expiresAt <= Date.now() + 60_000
  );
}
