import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  createPersistedSettings,
  isValidSlackClientId,
  loadSettingsWithSession,
  mergeSettings,
} from '../src/settings';
import type { SessionCipher } from '../src/slack/secure-session';

const cipher: SessionCipher = {
  decrypt: (value) => Buffer.from(value, 'base64').toString('utf8'),
  encrypt: (value) => Buffer.from(value, 'utf8').toString('base64'),
  isAvailable: () => true,
};

const unavailableCipher: SessionCipher = {
  decrypt: () => '',
  encrypt: () => '',
  isAvailable: () => false,
};

describe('mergeSettings', () => {
  it('fills in omitted settings with defaults', () => {
    expect(
      mergeSettings({
        idleDelayMs: 900,
        session: { teamId: 'T01', workspace: 'acme' },
      })
    ).toEqual({
      ...DEFAULT_SETTINGS,
      idleDelayMs: 900,
      session: {
        ...DEFAULT_SETTINGS.session,
        teamId: 'T01',
        workspace: 'acme',
      },
    });
  });
});

describe('isValidSlackClientId', () => {
  it('accepts a well-formed Slack client ID', () => {
    expect(isValidSlackClientId('1234567890.1234567890')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidSlackClientId('')).toBe(false);
  });

  it('rejects a string without a dot', () => {
    expect(isValidSlackClientId('1234567890')).toBe(false);
  });

  it('rejects a string with trailing text', () => {
    expect(isValidSlackClientId('123.456abc')).toBe(false);
  });

  it('rejects a string with leading text', () => {
    expect(isValidSlackClientId('abc123.456')).toBe(false);
  });

  it('rejects a string with spaces', () => {
    expect(isValidSlackClientId('123. 456')).toBe(false);
  });
});

describe('createPersistedSettings', () => {
  it('stores the session in encrypted form instead of plaintext settings', () => {
    const persisted = createPersistedSettings(
      {
        ...DEFAULT_SETTINGS,
        session: {
          accessToken: 'xoxp-access',
          expiresAt: 1_714_490_435_000,
          refreshToken: 'xoxe-refresh',
          teamId: 'T01',
          workspace: 'acme',
        },
      },
      cipher
    );

    expect(persisted.encryptedSession).not.toBe('');
    expect(persisted.session).toEqual(DEFAULT_SETTINGS.session);
  });
});

describe('loadSettingsWithSession', () => {
  it('restores the encrypted session into runtime settings', () => {
    const persisted = createPersistedSettings(
      {
        ...DEFAULT_SETTINGS,
        session: {
          accessToken: 'xoxp-access',
          expiresAt: 1_714_490_435_000,
          refreshToken: 'xoxe-refresh',
          teamId: 'T01',
          workspace: 'acme',
        },
      },
      cipher
    );

    expect(loadSettingsWithSession(persisted, cipher).session).toEqual({
      accessToken: 'xoxp-access',
      expiresAt: 1_714_490_435_000,
      refreshToken: 'xoxe-refresh',
      teamId: 'T01',
      workspace: 'acme',
    });
  });
});

describe('createPersistedSettings without secure storage', () => {
  it('never falls back to persisting plaintext session tokens', () => {
    const persisted = createPersistedSettings(
      {
        ...DEFAULT_SETTINGS,
        session: {
          accessToken: 'xoxp-access',
          expiresAt: 1_714_490_435_000,
          refreshToken: 'xoxe-refresh',
          teamId: 'T01',
          workspace: 'acme',
        },
      },
      unavailableCipher
    );

    expect(persisted.encryptedSession).toBe('');
    expect(persisted.session).toEqual(DEFAULT_SETTINGS.session);
  });
});
