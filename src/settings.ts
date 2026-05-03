import type { LinkTargetPreference, SlackSession } from './slack/types';
import {
  decodeSecureSession,
  encodeSecureSession,
  type SessionCipher,
} from './slack/secure-session';

export interface SlackBasesSettings {
  channelCacheTtlMs: number;
  clientId: string;
  encryptedSession: string;
  enableChannels: boolean;
  enableDmSentinels: boolean;
  enablePermalinks: boolean;
  failedLookupTtlMs: number;
  idleDelayMs: number;
  messageTemplate: string;
  refreshLeewayMs: number;
  scopes: string;
  session: SlackSession;
  target: LinkTargetPreference;
  userCacheTtlMs: number;
}

export const DEFAULT_SETTINGS: SlackBasesSettings = {
  channelCacheTtlMs: 60 * 60 * 1000,
  clientId: '',
  encryptedSession: '',
  enableChannels: true,
  enableDmSentinels: true,
  enablePermalinks: true,
  failedLookupTtlMs: 5 * 60 * 1000,
  idleDelayMs: 500,
  messageTemplate: '[{channel} • {author}: {text}]({url})',
  refreshLeewayMs: 60 * 1000,
  scopes: 'channels:read,groups:read,users:read,users:read.email,channels:history,groups:history',
  session: {
    accessToken: '',
    expiresAt: 0,
    refreshToken: '',
    teamId: '',
    workspace: '',
  },
  target: 'app',
  userCacheTtlMs: 60 * 60 * 1000,
};

export function mergeSettings(
  partial: Partial<SlackBasesSettings> | undefined
): SlackBasesSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    session: {
      ...DEFAULT_SETTINGS.session,
      ...partial?.session,
    },
  };
}

export function createPersistedSettings(
  settings: SlackBasesSettings,
  cipher?: SessionCipher | null
): SlackBasesSettings {
  if (!hasSessionData(settings.session)) {
    return {
      ...settings,
      encryptedSession: '',
      session: { ...DEFAULT_SETTINGS.session },
    };
  }

  if (!cipher?.isAvailable()) {
    return {
      ...settings,
      encryptedSession: '',
      session: { ...DEFAULT_SETTINGS.session },
    };
  }

  return {
    ...settings,
    encryptedSession: encodeSecureSession(settings.session, cipher),
    session: { ...DEFAULT_SETTINGS.session },
  };
}

export function loadSettingsWithSession(
  partial: Partial<SlackBasesSettings> | undefined,
  cipher?: SessionCipher | null
): SlackBasesSettings {
  const merged = mergeSettings(partial);

  if (!merged.encryptedSession || !cipher?.isAvailable()) {
    return merged;
  }

  return {
    ...merged,
    session: {
      ...DEFAULT_SETTINGS.session,
      ...decodeSecureSession(merged.encryptedSession, cipher),
    },
  };
}

function hasSessionData(session: SlackSession): boolean {
  return Boolean(
    session.accessToken ||
      session.refreshToken ||
      session.teamId ||
      session.workspace ||
      session.expiresAt
  );
}
