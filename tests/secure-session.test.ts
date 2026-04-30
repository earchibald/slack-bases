import { describe, expect, it } from 'vitest';

import {
  decodeSecureSession,
  encodeSecureSession,
  type SessionCipher,
} from '../src/slack/secure-session';

const cipher: SessionCipher = {
  decrypt: (value) => Buffer.from(value, 'base64').toString('utf8'),
  encrypt: (value) => Buffer.from(value, 'utf8').toString('base64'),
  isAvailable: () => true,
};

describe('encodeSecureSession', () => {
  it('round-trips a Slack session through encrypted persistence', () => {
    const session = {
      accessToken: 'xoxp-access',
      expiresAt: 1_714_490_435_000,
      refreshToken: 'xoxe-refresh',
      teamId: 'T01',
      workspace: 'acme',
    };

    expect(decodeSecureSession(encodeSecureSession(session, cipher), cipher)).toEqual(session);
  });
});
