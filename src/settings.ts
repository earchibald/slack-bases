import type { LinkTargetPreference, SlackSession } from './slack/types';

export interface SlackBasesSettings {
  channelCacheTtlMs: number;
  clientId: string;
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
